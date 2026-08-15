import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { callOlagon, gatewayConfig } from "@/lib/olagon-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sends the smallest possible request to the AI gateway and reports what came
 * back. Answers "is the gateway actually reachable from the deployment?"
 * without uploading a document, so a failure here is unambiguously about the
 * gateway rather than about file size or the 60 s function limit.
 *
 * Requires a session: it spends gateway quota, so it is not left open to
 * anonymous callers. Reports the key's shape, never the key.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { apiKey, baseUrl, model } = gatewayConfig();
  const config = {
    baseUrl,
    model,
    apiKeySet: !!apiKey,
    apiKeyLength: apiKey?.length ?? 0,
    // The documented client key format is rk_live_...; anything else usually
    // means a key from the wrong place was pasted.
    apiKeyLooksLikeOlagonKey: !!apiKey && apiKey.startsWith("rk_"),
  };

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, config, error: "OLAGON_API_KEY belum diset di environment" },
      { status: 500 }
    );
  }

  const startedAt = Date.now();
  try {
    const reply = await callOlagon({
      system: "Balas dengan satu kata: OK",
      content: [{ type: "text", text: "ping" }],
      // Not 16: if the model behind the gateway emits a thinking block first,
      // a tight budget is spent before any text block exists, and the reply
      // comes back empty for a reason that has nothing to do with the gateway.
      maxTokens: 256,
    });
    return NextResponse.json({
      ok: true,
      config,
      latencyMs: Date.now() - startedAt,
      reply: reply.slice(0, 80),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        config,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
