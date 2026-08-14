"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import Navbar from "@/components/Navbar";
import { useI18n } from "@/lib/i18n/I18nContext";

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    } else {
      setError(t("login.error"));
    }
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
