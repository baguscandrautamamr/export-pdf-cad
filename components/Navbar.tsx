"use client";

import { signOut, useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n/I18nContext";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";

export default function Navbar() {
  const { t } = useI18n();
  const { data: session } = useSession();

  return (
    <header className="glass-navbar">
      <div className="navbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          <div>
            <strong>{t("app.title")}</strong>
            <small>{t("app.tagline")}</small>
          </div>
        </div>
        <nav className="navbar-actions">
          <LanguageToggle />
          <ThemeToggle />
          {session ? (
            <button
              type="button"
              className="glass-button"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              {t("nav.signOut")}
            </button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
