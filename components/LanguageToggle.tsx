"use client";

import { useI18n } from "@/lib/i18n/I18nContext";

export default function LanguageToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      type="button"
      className="glass-button"
      onClick={() => setLocale(locale === "id" ? "en" : "id")}
      aria-label={locale === "id" ? "Switch to English" : "Ganti ke Bahasa Indonesia"}
      title={locale === "id" ? "Switch to English" : "Ganti ke Bahasa Indonesia"}
    >
      {locale === "id" ? "ID" : "EN"}
    </button>
  );
}
