"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import Navbar from "@/components/Navbar";
import { useI18n } from "@/lib/i18n/I18nContext";

/**
 * callbackUrl arrives from the query string, so treat it as untrusted: allow a
 * same-site path and nothing else, or an attacker can turn the login page into
 * an open redirect by linking to /login?callbackUrl=https://elsewhere.
 */
function safeCallback(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDetail("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.ok) {
      // Full page load, not router.push(): the App Router keeps a client-side
      // cache of already-visited routes, and "/" was visited a moment ago as
      // the redirect that landed us here. Pushing to it can re-render that
      // cached copy — the login page again — even though the session is now
      // valid. A real navigation re-requests the page with the new cookie.
      window.location.assign(safeCallback(callbackUrl));
      return; // keep the button disabled while the browser navigates
    }
    setLoading(false);
    setError(t("login.error"));
    // NextAuth reports "CredentialsSignin" when authorize() rejected the
    // credentials, and something else entirely for a misconfiguration. Showing
    // the raw code turns "wrong password" into an answerable question — it
    // names no secret, only which branch failed.
    setDetail([res?.error, res?.status].filter(Boolean).join(" · "));
  }

  return (
    <GlassCard
      className="login-card"
      title={t("login.title")}
      description={t("login.subtitle")}
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">{t("login.email")}</label>
          {/* type="text", not "email": the demo account is a bare username
              ("user"), which the browser's email validation would reject. */}
          <input
            id="email"
            className="glass-input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            className="glass-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <div className="notice notice--error" role="alert" style={{ marginBottom: 12 }}>
            {error}
            {detail ? (
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {detail}
              </div>
            ) : null}
          </div>
        ) : null}
        <button type="submit" className="glass-button glass-button--primary" disabled={loading}>
          {loading ? t("login.loading") : t("login.submit")}
        </button>
      </form>
    </GlassCard>
  );
}

export default function LoginPage() {
  return (
    <>
      <Navbar />
      <main className="login-shell">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </>
  );
}
