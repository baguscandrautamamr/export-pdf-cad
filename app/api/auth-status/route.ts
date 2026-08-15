import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only report of what the running server sees, for diagnosing a login that
 * fails on a deployment you cannot attach a debugger to.
 *
 * Deliberately public: it has to answer precisely when signing in does not
 * work, so requiring a session would defeat it. It therefore reports only
 * whether things are set, never what they are — no secret, no password, no
 * hash, not even the configured username. The commit is the useful part: it
 * says which build is actually live, which is the question that env-var and
 * code-version confusion always comes down to.
 */
export async function GET() {
  const hash = process.env.DEMO_USER_PASSWORD_HASH?.trim();
  const plain = process.env.DEMO_USER_PASSWORD?.trim();
  const hashUsable = !!hash && /^\$2[aby]?\$\d{2}\$/.test(hash);
  const url = process.env.NEXTAUTH_URL?.trim();

  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "(bukan Vercel)",
    nodeEnv: process.env.NODE_ENV,
    onVercel: !!process.env.VERCEL,

    nextAuthSecretSet: !!process.env.NEXTAUTH_SECRET,
    nextAuthUrlSet: !!url,
    // Must be "https" on a deployed site. Anything else — most often the
    // protocol missing altogether — means NextAuth's handler and getToken can
    // disagree about cookie names. The middleware no longer depends on this,
    // but it still affects callback and redirect URLs, so it is worth seeing.
    nextAuthUrlProtocol: url ? (url.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1] ?? null) : null,
    nextAuthUrlHasProtocol: !!url && /^[a-z][a-z0-9+.-]*:\/\//i.test(url),

    demoEmailSet: !!process.env.DEMO_USER_EMAIL?.trim(),
    passwordSource: hashUsable ? "bcrypt" : plain ? "plaintext" : "none",
    passwordHashPresentButUnreadable: !!hash && !hashUsable,

    // Present only in builds that carry the plaintext-password support. If this
    // is false, the deployment predates it and DEMO_USER_PASSWORD is ignored.
    supportsPlaintextPassword: true,

    internalApiSecretSet: !!process.env.INTERNAL_API_SECRET,
  });
}
