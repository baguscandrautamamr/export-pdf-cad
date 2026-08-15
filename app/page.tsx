"use client";

import { useMemo, useRef, useState } from "react";
import GlassCard from "@/components/GlassCard";
import Navbar from "@/components/Navbar";
import { useI18n } from "@/lib/i18n/I18nContext";
import { SAMPLE_LOADS } from "@/lib/sample";
import type { ExtractResponse, GenerateResponse, GeneratedFile } from "@/types/loads";

/**
 * Vercel caps a serverless function's request body at ~4.5 MB, well under the
 * 15 MB the route itself allows when this app runs somewhere without that
 * limit. Checking in the browser turns a platform-level rejection — which comes
 * back as an HTML error page, not JSON — into a message that names the file and
 * its size before anything is uploaded.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * A crashed, timed-out or rejected serverless function answers with the
 * platform's HTML error page, not JSON. Parsing that blindly surfaces
 * "Unexpected token 'A'" to the user, which says nothing about what went
 * wrong — so read the body as text first and translate the status instead.
 */
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(explainNonJson(res.status, text));
  }
}

function explainNonJson(status: number, body: string): string {
  const head = body.trim().slice(0, 120);
  if (status === 413) {
    return `Berkas terlalu besar untuk server (HTTP 413). Batas body di Vercel ~4,5 MB, jauh di bawah batas 15 MB yang berlaku saat dijalankan sendiri.`;
  }
  if (status === 504 || status === 408) {
    return `Server melebihi batas waktu (HTTP ${status}). Fungsi Vercel berhenti di 60 detik; dokumen besar bisa melampauinya.`;
  }
  if (status >= 500) {
    return `Fungsi server gagal sebelum sempat membalas (HTTP ${status}). Penyebab paling umum: melewati batas waktu 60 detik, atau berkas melebihi batas body ~4,5 MB. Cek Runtime Logs di Vercel. Balasan: ${head}`;
  }
  return `Server membalas bukan JSON (HTTP ${status}). Balasan: ${head}`;
}

export default function HomePage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [error, setError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const parsed = useMemo(() => {
    if (!json.trim()) return null;
    try {
      const value = JSON.parse(json) as { loads?: unknown[] };
      return { ok: true as const, count: Array.isArray(value.loads) ? value.loads.length : 0 };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "" };
    }
  }, [json]);

  function reset() {
    setError("");
    setSummary([]);
    setFiles([]);
  }

  async function extract() {
    if (!file) return;
    reset();
    setWarnings([]);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `${file.name} berukuran ${mb(file.size)} MB, melebihi batas unggah ${mb(MAX_UPLOAD_BYTES)} MB. ` +
          `Kecilkan PDF-nya, atau ambil hanya halaman yang memuat equipment schedule.`
      );
      return;
    }
    setExtracting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body });
      const data = await readJson<ExtractResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setJson(JSON.stringify(data.loads, null, 2));
      setWarnings(data.warnings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }

  async function generate() {
    reset();
    setGenerating(true);
    try {
      const loads = JSON.parse(json);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loads }),
      });
      const data = await readJson<GenerateResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSummary(data.summary ?? []);
      setFiles(data.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function download(f: GeneratedFile) {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Navbar />
      <main className="page">
        <div className="page-heading fade-in">
          <h1>{t("home.heading")}</h1>
          <p>{t("home.subheading")}</p>
        </div>

        {error ? (
          <div className="notice notice--error fade-in" role="alert">
            <strong>{t("error.title")}</strong>
            {error}
          </div>
        ) : null}

        <GlassCard title={t("step.1.title")} description={t("step.1.desc")}>
          <div className="row">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
            />
            <button
              type="button"
              className="glass-button"
              onClick={() => fileRef.current?.click()}
            >
              {t("step.1.choose")}
            </button>
            <span className="filename">{file ? file.name : t("step.1.noFile")}</span>
            <button
              type="button"
              className="glass-button glass-button--primary"
              onClick={extract}
              disabled={!file || extracting}
            >
              {extracting ? t("step.1.extracting") : t("step.1.extract")}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            {t("step.1.skip")}{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                reset();
                setWarnings([]);
                setJson(JSON.stringify(SAMPLE_LOADS, null, 2));
              }}
            >
              {t("step.1.useExample")}
            </button>
          </p>
        </GlassCard>

        {warnings.length > 0 ? (
          <div className="notice notice--warn fade-in">
            <strong>{t("warnings.title")}</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <GlassCard title={t("step.2.title")} description={t("step.2.desc")}>
          <textarea
            className="glass-input code-area"
            spellCheck={false}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='{ "panel": { "name": "PP-HVAC" }, "loads": [] }'
          />
          <div className="row" style={{ marginTop: 12 }}>
            {parsed ? (
              parsed.ok ? (
                <span className="status status--ok">
                  ✓ {t("step.2.validJson")} — {parsed.count} {t("step.2.circuits")}
                </span>
              ) : (
                <span className="status status--bad">
                  ✕ {t("step.2.invalidJson")}: {parsed.message}
                </span>
              )
            ) : null}
            <button
              type="button"
              className="glass-button"
              disabled={!parsed?.ok}
              onClick={() => setJson(JSON.stringify(JSON.parse(json), null, 2))}
              style={{ marginLeft: "auto" }}
            >
              {t("step.2.format")}
            </button>
          </div>
        </GlassCard>

        <GlassCard title={t("step.3.title")} description={t("step.3.desc")}>
          <button
            type="button"
            className="glass-button glass-button--primary"
            onClick={generate}
            disabled={!parsed?.ok || generating}
          >
            {generating ? t("step.3.generating") : t("step.3.generate")}
          </button>

          {summary.length > 0 ? (
            <>
              <p className="muted" style={{ marginTop: 20, marginBottom: 0 }}>
                {t("step.3.summary")}
              </p>
              <pre className="summary">{summary.join("\n")}</pre>
            </>
          ) : null}

          {files.length > 0 ? (
            <>
              <p className="muted" style={{ marginTop: 20, marginBottom: 0 }}>
                {t("step.3.files")}
              </p>
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f.name}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className="glass-button"
                      onClick={() => download(f)}
                    >
                      {t("step.3.download")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </GlassCard>
      </main>
    </>
  );
}
