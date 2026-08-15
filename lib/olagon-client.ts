/**
 * Thin wrapper over the Olagon AI Gateway (third-party proxy, Anthropic-compatible
 * request format). Server-only: OLAGON_API_KEY must never reach the browser, so
 * never import this from a client component.
 *
 * Note that uploaded documents transit Olagon's servers, not Anthropic's directly.
 * Swapping to another Anthropic-compatible endpoint is a matter of changing
 * OLAGON_BASE_URL and the key — nothing below is Olagon-specific beyond the header.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }> | string;
  stop_reason?: string;
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string };
}

export interface CallOptions {
  system: string;
  content: ContentBlock[];
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * What the call did, whether or not it produced an answer.
 *
 * These numbers exist because "the gateway did not reply in time" describes
 * three completely different failures — a gateway that never answers, a gateway
 * that answers slowly, and a document whose extraction genuinely takes longer
 * than the platform allows — and without them the three are indistinguishable
 * from the screen. Time to first byte separates the first from the other two;
 * the character count separates the second from the third.
 */
export interface CallStats {
  /** ms from request start to the first byte of the response body, null if none arrived. */
  ttfbMs: number | null;
  /** Characters of assistant text received before finishing or giving up. */
  chars: number;
  /**
   * SSE events seen, of any kind.
   *
   * Distinguishes a stream that is alive but has produced no answer yet — the
   * gateway sending message_start and keepalives while the model still reads
   * the document — from one that went silent after opening. Both show
   * chars: 0, and they mean different things.
   */
  frames: number;
  /** ms from request start until the call returned or gave up. */
  elapsedMs: number;
  /** Whether the reply arrived as a token stream or as one buffered JSON body. */
  streamed: boolean;
  stopReason?: string;
}

export interface CallResult {
  text: string;
  stats: CallStats;
}

/**
 * How long a single gateway call may take.
 *
 * On Vercel the platform kills the function at maxDuration — 60 s on Hobby, the
 * ceiling the routes declare — and what the browser receives then is an HTML
 * error page rather than anything this code wrote. So give up first, but only
 * just: the old fixed 45 s left a quarter of the allowance unused, which is
 * exactly the margin a large schedule needs. The remainder covers reading the
 * upload, base64-encoding it, and serialising the answer.
 *
 * Self-hosted there is no such wall. A big equipment schedule legitimately
 * takes longer than any Vercel budget, and cutting it off at 45 s there was
 * only ever a Vercel constraint leaking into every other environment.
 */
export function gatewayBudgetMs(): number {
  return process.env.VERCEL ? 52_000 : 240_000;
}

export function gatewayConfig() {
  const apiKey = process.env.OLAGON_API_KEY;
  const baseUrl = (
    process.env.OLAGON_BASE_URL || "https://gateway.olagon.site/anthropic"
  ).replace(/\/+$/, "");
  const model = process.env.OLAGON_MODEL || "claude-sonnet-4-6";
  return { apiKey, baseUrl, model };
}

/**
 * Sends one request and returns the assistant's text.
 *
 * Streaming, because the alternative wastes the whole budget on an unknown. A
 * buffered request returns nothing at all until the model has finished writing,
 * so a call that needed 50 s and a gateway that was never going to answer look
 * identical right up to the moment the deadline passes. Streaming puts the
 * first bytes on the wire in a second or two, which means a failure afterwards
 * can say how far it got — and it keeps intermediate proxies from dropping a
 * connection that has gone quiet.
 */
export async function callOlagon({
  system,
  content,
  maxTokens = 8000,
  signal,
}: CallOptions): Promise<CallResult> {
  const { apiKey, baseUrl, model } = gatewayConfig();
  if (!apiKey) {
    throw new Error("OLAGON_API_KEY belum diset di environment");
  }

  const startedAt = Date.now();
  const budgetMs = gatewayBudgetMs();
  const deadline = signal ?? AbortSignal.timeout(budgetMs);
  const stats: CallStats = { ttfbMs: null, chars: 0, frames: 0, elapsedMs: 0, streamed: true };

  const send = (stream: boolean) =>
    fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
        ...(stream ? { stream: true } : {}),
      }),
      signal: deadline,
    });

  let res: Response;
  try {
    res = await send(true);

    // A proxy that does not do SSE is a real possibility — this one serves
    // several upstreams and is not obliged to implement every part of the API
    // it imitates. Fall back rather than fail, but only for an error that
    // actually names streaming, so a bad key does not cost two round trips.
    if (!res.ok) {
      const body = await res.text();
      if (/stream/i.test(body)) {
        stats.streamed = false;
        res = await send(false);
      } else {
        throw new GatewayHttpError(res.status, body);
      }
    }
  } catch (err) {
    if (err instanceof GatewayHttpError) throw describeHttpError(err);
    throw describeTransportError(err, baseUrl, startedAt, stats);
  }

  try {
    if (!res.ok) {
      throw describeHttpError(new GatewayHttpError(res.status, await res.text()));
    }

    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
    const { text, stopReason } = isSse
      ? await readSse(res, startedAt, stats)
      : await readBuffered(res, startedAt, stats);

    stats.elapsedMs = Date.now() - startedAt;
    stats.chars = text.length;
    stats.stopReason = stopReason;

    if (!text) {
      throw new Error(
        `Gateway membalas tanpa isi teks (${summarise(stats)}).` +
          (stopReason ? ` stop_reason=${stopReason}.` : "")
      );
    }
    return { text, stats };
  } catch (err) {
    if (err instanceof Error && !isAbort(err)) throw err;
    throw describeTransportError(err, baseUrl, startedAt, stats);
  }
}

class GatewayHttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function isAbort(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function describeHttpError(err: GatewayHttpError): Error {
  let message = err.body.slice(0, 300);
  try {
    message = (JSON.parse(err.body) as MessagesResponse).error?.message ?? message;
  } catch {
    // Body was not JSON; the raw snippet above is the best available.
  }
  return new Error(`Gateway error HTTP ${err.status}: ${message}`);
}

/**
 * Turns a transport failure into a sentence that says which failure it was.
 *
 * There are three, not two, and the middle one is easy to miss. Bytes arriving
 * is not the same as an answer arriving: the gateway opens the stream and sends
 * message_start (and keepalives) as soon as it has accepted the request, long
 * before the model has read the document. So a call can have a healthy time to
 * first byte and still not have received a single character of answer.
 *
 *   no bytes at all      the gateway or the network
 *   bytes, no text       the model never started writing — the whole budget
 *                        went into reading the document
 *   text, then cut off   the answer was genuinely too long to finish
 *
 * The first version of this collapsed the middle case into the third and told
 * the reader the gateway had "sent part of an answer" when it had sent none.
 */
function describeTransportError(
  err: unknown,
  baseUrl: string,
  startedAt: number,
  stats: CallStats
): Error {
  stats.elapsedMs = Date.now() - startedAt;
  // Elapsed time, not the configured budget: a caller may pass its own signal,
  // and quoting a limit that did not fire sends the reader looking in the wrong
  // place. What was actually spent is the number that describes the failure.
  const seconds = (stats.elapsedMs / 1000).toFixed(1);

  if (!isAbort(err)) {
    return new Error(
      `Tidak bisa menghubungi gateway di ${baseUrl}: ${(err as Error)?.message ?? String(err)}`
    );
  }

  if (stats.ttfbMs === null) {
    return new Error(
      `Gateway tidak membalas sama sekali setelah ${seconds} detik (${baseUrl}). ` +
        `Tidak ada satu byte pun yang diterima, jadi ini soal gateway atau ` +
        `jaringan, bukan ukuran dokumen. Cek /api/gateway-check.`
    );
  }

  if (stats.chars === 0) {
    return new Error(
      `Model belum menulis sehuruf pun sampai batas ${seconds} detik ` +
        `(${summarise(stats)}). Koneksi ke gateway sehat — byte pertama datang di ` +
        `${stats.ttfbMs} ms — tapi seluruh sisa waktunya habis untuk MEMBACA dokumen, ` +
        `belum sampai menulis jawaban. Ini soal berat dokumen, bukan panjang jawaban: ` +
        `potong PDF-nya hanya ke halaman yang memuat equipment schedule.`
    );
  }

  return new Error(
    `Jawaban terpotong di tengah setelah ${seconds} detik (${summarise(stats)}). ` +
      `Model sudah menulis ${stats.chars} karakter tapi belum selesai, jadi ` +
      `schedule-nya terlalu panjang untuk satu permintaan — pecah per panel, atau ` +
      `kirim halamannya sebagian dulu.`
  );
}

function summarise(stats: CallStats): string {
  const ttfb = stats.ttfbMs === null ? "tidak ada balasan" : `byte pertama ${stats.ttfbMs} ms`;
  // Frame count separates a stream that is alive but silent — keepalives with
  // no content — from one that delivered nothing after the opening event.
  return (
    `${ttfb}, ${stats.frames} frame, ${stats.chars} karakter teks, ` +
    `total ${stats.elapsedMs} ms`
  );
}

/**
 * Reads an Anthropic SSE stream, and an OpenAI-shaped one too.
 *
 * The OpenAI branch is here for the same reason the buffered reader tolerates
 * choices[]: a proxy fronting several upstreams tends to pass through whatever
 * shape the upstream produced.
 */
async function readSse(
  res: Response,
  startedAt: number,
  stats: CallStats
): Promise<{ text: string; stopReason?: string }> {
  if (!res.body) return { text: "" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | undefined;

  const handle = (raw: string) => {
    stats.frames += 1;
    // An event may carry several data: lines, which concatenate.
    const payload = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!payload || payload === "[DONE]") return;

    let event: {
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string; content?: string };
      error?: { message?: string };
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
    };
    try {
      event = JSON.parse(payload);
    } catch {
      return; // A partial or unrecognised frame is not worth failing the call over.
    }

    if (event.error?.message) throw new Error(`Gateway error: ${event.error.message}`);
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      text += event.delta.text ?? "";
    }
    if (event.type === "message_delta" && event.delta?.stop_reason) {
      stopReason = event.delta.stop_reason;
    }
    const openai = event.choices?.[0];
    if (openai?.delta?.content) text += openai.delta.content;
    if (openai?.finish_reason) stopReason = openai.finish_reason;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (stats.ttfbMs === null) stats.ttfbMs = Date.now() - startedAt;
    // Normalise line endings so one frame separator works for both spellings.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handle(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    // After the frames, not before: this is the count a timeout will report,
    // and updating it first leaves it a whole read behind the text it describes.
    stats.chars = text.length;
  }
  if (buffer.trim()) handle(buffer);

  return { text: text.trim(), stopReason };
}

/** One buffered JSON body — the shape a proxy returns when it ignores stream:true. */
async function readBuffered(
  res: Response,
  startedAt: number,
  stats: CallStats
): Promise<{ text: string; stopReason?: string }> {
  const raw = await res.text();
  stats.ttfbMs = Date.now() - startedAt;
  stats.streamed = false;

  let data: MessagesResponse;
  try {
    data = JSON.parse(raw) as MessagesResponse;
  } catch {
    throw new Error(`Gateway membalas non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
  }
  const text = extractText(data);
  if (!text) {
    throw new Error(
      `Gateway membalas tanpa isi teks. Bentuk balasan: ${describeResponse(data, raw)}`
    );
  }
  return { text, stopReason: data.stop_reason };
}

/**
 * Pulls the assistant's text out of a buffered response.
 *
 * The documented shape is Anthropic's — content as an array of blocks — but
 * this goes through a third-party proxy, so the tolerated variations are worth
 * having: content as a bare string, and the OpenAI-style choices array that
 * proxies serving several upstreams often fall back to. Non-text blocks such as
 * thinking are skipped rather than treated as content.
 */
function extractText(data: MessagesResponse): string {
  const { content } = data;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    if (text) return text;
  }

  const choice = data.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice.trim();

  return "";
}

/** Names the response's structure without dumping a whole document back out. */
function describeResponse(data: MessagesResponse, raw: string): string {
  const keys = Object.keys(data ?? {}).join(", ") || "(kosong)";
  const blocks = Array.isArray(data?.content)
    ? data.content.map((b) => b?.type ?? "?").join(", ")
    : typeof data?.content;
  const stop = data?.stop_reason ? `, stop_reason=${data.stop_reason}` : "";
  return `keys=[${keys}], content=${blocks}${stop}. Cuplikan: ${raw.slice(0, 300)}`;
}

/**
 * Models like to wrap JSON in prose or a ```json fence. Pull the outermost
 * object out rather than trusting the whole body to parse.
 */
export function parseJsonFromModel<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new Error("Balasan model bukan JSON yang valid");
  }
}
