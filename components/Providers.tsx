"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme/ThemeContext";
import { I18nProvider } from "@/lib/i18n/I18nContext";
import ServiceWorkerRegister from "./ServiceWorkerRegister";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <I18nProvider>
          <ServiceWorkerRegister />
          {children}
        </I18nProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
