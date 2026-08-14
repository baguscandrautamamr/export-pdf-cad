"use client";

import { useTheme } from "@/lib/theme/ThemeContext";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const label = theme === "light" ? t("nav.theme.dark") : t("nav.theme.light");

  return (
    <button
      type="button"
      className="glass-button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{theme === "light" ? "🌙" : "☀️"}</span>
    </button>
  );
}
