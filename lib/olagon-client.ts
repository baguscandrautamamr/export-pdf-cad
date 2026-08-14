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
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string; type?: string };
}

export interface CallOptions {
  system: string;
  content: ContentBlock[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export function gatewayConfig() {
  const apiKey = process.env.OLAGON_API_KEY;
  const baseUrl = (
    process.env.OLAGON_BASE_URL || "https://gateway.olagon.site/anthropic"
  ).replace(/\/+$/, "");
  const model = process.env.OLAGON_MODEL || "claude-sonnet-4-6";
  return { apiKey, baseUrl, model };
}

/** Sends one non-streaming request and returns the concatenated text blocks. */
export async function callOlagon({
  system,
  content,
  maxTokens = 8000,
  signal,
}: CallOptions): Promise<string> {
  const { apiKey, baseUrl, model } = gatewayConfig();
  if (!apiKey) {
    throw new Error("OLAGON_API_KEY belum diset di environment");
  }

  const res = await fetch(`${baseUrl}/v1/messages`, {
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
    }),
    signal,
  });

  const raw = await res.text();
  let data: MessagesResponse;
  try {
    data = JSON.parse(raw) as MessagesResponse;
  } catch {
    throw new Error(
      `Gateway membalas non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Gateway error HTTP ${res.status}: ${data.error?.message ?? raw.slice(0, 300)}`
    );
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  if (!text) throw new Error("Gateway membalas tanpa isi teks");
  return text;
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
