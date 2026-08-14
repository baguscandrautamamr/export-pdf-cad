"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration failures are non-fatal: the app works fine without the SW,
    // it just loses the offline app shell.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
