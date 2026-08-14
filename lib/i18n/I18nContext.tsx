"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import id from "./messages/id.json";
import en from "./messages/en.json";

export type Locale = "id" | "en";

const MESSAGES: Record<Locale, Record<string, string>> = { id, en };
const STORAGE_KEY = "psg.locale";

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Default is Indonesian; browser language only decides the first visit, and
  // only when nothing has been stored yet.
  const [locale, setLocaleState] = useState<Locale>("id");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "id" || stored === "en") {
      setLocaleState(stored);
      return;
    }
    if (navigator.language?.toLowerCase().startsWith("en")) setLocaleState("en");
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string) => MESSAGES[locale][key] ?? MESSAGES.id[key] ?? key,
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
