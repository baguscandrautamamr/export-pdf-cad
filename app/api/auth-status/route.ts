import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only report of what the running server sees, for diagnosing a login that
 * fails on a deployment you cannot attach a debugger to.
 *
 * The report is in two tiers, because the two halves have very different costs.
 *
 * The always-public tier says only whether things are set, never what they are.
 * It has to stay reachable without a session — the failure it exists to explain
 * is precisely "I cannot sign in" — and it is safe to, because nothing in it
 * narrows a guess at the credentials. The commit is the useful part: it says
 * which build is actually live, which is the question that env-var and
 * code-version confusion always comes down to.
 *
 * The shape tier describes the configured username and password closely enough
 * to spot a typo, and that is exactly why it cannot be public: "4 characters,
 * all lowercase letters, stored as plaintext" turns an unbounded guess into a
 * very short list. It is served only outside production, or in production to a
 * caller that presents AUTH_STATUS_TOKEN — so the deployment operator keeps the
 * diagnostic and a passer-by gets nothing that helps them.
 */

/**
 * Enough about a value to spot a typo, not enough to reveal it: how long it is,
 * whether it survived quoting or whitespace, and what kind of characters it
 * holds. A four-character all-lowercase-letter value with no quotes and no
 * whitespace is consistent with "user"; six characters means the quotes were
 * stored too; a capital shows up as isLowercase false.
 */
function describeShape(raw: string | undefined) {
  if (raw === undefined) return { set: false };
  const trimmed = raw.trim();
  return {
    set: true,
    length: trimmed.length,
    lengthBeforeTrim: raw.length,
    isLowercase: trimmed === trimmed.toLowerCase(),
    onlyLetters: /^[a-z]+$/i.test(trimmed),
    hasQuotes: /^["']|["']$/.test(trimmed),
    hasInnerWhitespace: /\s/.test(trimmed),
  };
}

/**
 * Whether this caller may see the shape tier.
 *
 * Outside production it is always allowed — a dev server holds no credential
 * worth protecting, and needing a token there would just get in the way. In
 * production it takes ?token=<AUTH_STATUS_TOKEN>, compared over digests so
 * neither the token nor its length leaks through timing. With the variable
 * unset, production simply never serves the shape tier.
 */
function maySeeShapes(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const expected = process.env.AUTH_STATUS_TOKEN?.trim();
  if (!expected) return false;

  const provided = new URL(req.url).searchParams.get("token")?.trim();
  if (!provided) return false;

  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(provided, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const shapesVisible = maySeeShapes(req);
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

    // Shape of the configured values, never the values themselves. A dashboard
    // marks these Sensitive and will not show them again, so when sign-in is
    // refused with the configuration apparently correct, this is what
    // distinguishes user from "user", User, or user with a stray character.
    //
    // Withheld in production without a token: see maySeeShapes(). The field
    // stays present either way so a caller can tell "withheld" apart from an
    // older build that never had it.
    shapesVisible,
    demoEmail: shapesVisible ? describeShape(process.env.DEMO_USER_EMAIL) : null,
    demoPassword: shapesVisible ? describeShape(process.env.DEMO_USER_PASSWORD) : null,
    shapesHint: shapesVisible
      ? undefined
      : "Set AUTH_STATUS_TOKEN di environment, lalu panggil /api/auth-status?token=<nilainya>",

    // Present only in builds that carry the plaintext-password support. If this
    // is false, the deployment predates it and DEMO_USER_PASSWORD is ignored.
    supportsPlaintextPassword: true,

    internalApiSecretSet: !!process.env.INTERNAL_API_SECRET,
  });
}
