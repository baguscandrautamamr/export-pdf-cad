import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authOptions } from "@/lib/auth";
import { validateLoads } from "@/lib/validate";
import type { LoadsFile } from "@/types/loads";

export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(execFile);
// Windows installs the interpreter as "python" (and the launcher as "py");
// "python3" does not exist there, so defaulting to it makes every generate fail
// with ENOENT on an otherwise correct setup. PYTHON_BIN still overrides both.
const PYTHON =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const SCRIPT_DIR = path.join(process.cwd(), "python");
const TIMEOUT_MS = 55_000;

const MIME: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".dxf": "image/vnd.dxf",
  ".pdf": "application/pdf",
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let loads: LoadsFile;
  try {
    const body = (await req.json()) as { loads?: LoadsFile };
    if (!body?.loads) throw new Error("field 'loads' tidak ada");
    loads = body.loads;
  } catch (err) {
    return NextResponse.json(
      { error: `Body JSON tidak valid: ${err instanceof Error ? err.message : "?"}` },
      { status: 400 }
    );
  }

  // Every field below is one the Python builders index into directly, so
  // checking here is what turns "KeyError: 'watt'" into a list naming the rows
  // to fix. The JSON arrives from a textarea the user is meant to edit by hand,
  // which makes malformed input the expected case rather than an odd one.
  const problems = validateLoads(loads);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: `loads.json tidak valid:\n${problems.map((p) => `• ${p}`).join("\n")}`, problems },
      { status: 400 }
    );
  }

  // Vercel's Node runtime has no python3, so there the builders live in a
  // separate function (api/build.py) and this route only proxies to it. The
  // same path serves a self-hosted Python service: point PYTHON_SERVICE_URL at
  // it and nothing else changes.
  const serviceUrl = pythonServiceUrl();
  if (serviceUrl) {
    return proxyToPythonService(serviceUrl, loads);
  }

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "panel-"));
  try {
    const input = path.join(tmpdir, "loads.json");
    await fs.writeFile(input, JSON.stringify(loads, null, 2), "utf8");

    const summary: string[] = [];
    for (const script of ["build_xlsx.py", "build_dxf.py"]) {
      const { stdout } = await run(PYTHON, [path.join(SCRIPT_DIR, script), input, tmpdir], {
        timeout: TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      });
      // "OK <abs path>" leaks the temp dir into the UI; the file list already
      // carries the names, so keep only the substantive lines.
      summary.push(
        ...stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("OK "))
      );
    }

    // Read whatever the scripts produced rather than reconstructing the sanitised
    // file names here — panel_core.safe_name() is the only authority on those.
    const files = [];
    for (const name of await fs.readdir(tmpdir)) {
      if (name === "loads.json") continue;
      const ext = path.extname(name).toLowerCase();
      if (!MIME[ext]) continue;
      files.push({
        name,
        mime: MIME[ext],
        base64: (await fs.readFile(path.join(tmpdir, name))).toString("base64"),
      });
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Script Python tidak menghasilkan berkas apa pun" },
        { status: 500 }
      );
    }

    return NextResponse.json({ summary, files });
  } catch (err) {
    // The builders exit 2 for a rejected loads.json — a caller error, not a
    // server fault. validateLoads() above catches most of these first, but the
    // Python side also rejects things this route does not model, such as an
    // ambient temperature outside the derating table.
    return NextResponse.json(
      { error: describe(err) },
      { status: isRejectedInput(err) ? 400 : 500 }
    );
  } finally {
    await fs.rm(tmpdir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Where the Python builders live, or null when this process can run them itself.
 *
 * An explicit PYTHON_SERVICE_URL always wins (option 2: Python deployed as its
 * own service). On Vercel with nothing set, default to the sibling function in
 * this same deployment, whose host is only known at request time.
 */
function pythonServiceUrl(): string | null {
  const explicit = process.env.PYTHON_SERVICE_URL?.trim();
  if (explicit) return explicit;
  if (!process.env.VERCEL) return null;
  const host = process.env.VERCEL_URL;
  return host ? `https://${host}/api/build` : null;
}

async function proxyToPythonService(url: string, loads: LoadsFile) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "INTERNAL_API_SECRET belum diset. Endpoint Python menolak permintaan tanpa secret ini (lihat README bagian Deploy).",
      },
      { status: 500 }
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ loads }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Tidak bisa menghubungi service Python di ${url}: ${describe(err)}` },
      { status: 502 }
    );
  }

  const text = await res.text();
  try {
    // Pass the upstream status through so a 400 stays a 400 rather than
    // becoming an opaque 502.
    return NextResponse.json(JSON.parse(text), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: `Service Python membalas non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` },
      { status: 502 }
    );
  }
}

/**
 * Whether the builders rejected the input rather than failing.
 *
 * They exit 2 for that case. execFile reports a non-zero exit in the same
 * `code` field it uses for spawn errors like "ENOENT", as a number rather than
 * a string — which NodeJS.ErrnoException types as string-only, hence the local
 * widening here.
 */
const REJECTED_INPUT_EXIT = 2;

function isRejectedInput(err: unknown): boolean {
  return (err as { code?: string | number })?.code === REJECTED_INPUT_EXIT;
}

function describe(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  if (e?.code === "ENOENT") {
    return (
      `Interpreter '${PYTHON}' tidak ditemukan. Pastikan Python terpasang dan ada di PATH, ` +
      `lalu jalankan 'pip install -r python/requirements.txt'. Kalau nama interpreter-nya ` +
      `berbeda di mesin ini, set PYTHON_BIN di .env.local (mis. PYTHON_BIN=py). Atau set ` +
      `PYTHON_SERVICE_URL kalau builder Python berjalan sebagai service terpisah (lihat ` +
      `README bagian Deploy).`
    );
  }
  if (e?.killed || e?.name === "TimeoutError") return "Script Python melebihi batas waktu";
  const stderr = e?.stderr?.trim();
  // Exit 2 is a rejected loads.json, and the builders print the reason on its
  // own — wrapping it in "Script Python gagal" would only make it read like a
  // crash. Anything else is a real failure and keeps the prefix and a tail of
  // the traceback.
  if (stderr && isRejectedInput(err)) return stderr;
  if (stderr) return `Script Python gagal: ${stderr.split("\n").slice(-6).join("\n")}`;
  return err instanceof Error ? err.message : "Generate gagal";
}
