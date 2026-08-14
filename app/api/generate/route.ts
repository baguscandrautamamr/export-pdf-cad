import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authOptions } from "@/lib/auth";
import type { LoadsFile } from "@/types/loads";

export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(execFile);
const PYTHON = process.env.PYTHON_BIN || "python3";
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

  if (!loads.panel?.name?.trim()) {
    return NextResponse.json({ error: "panel.name wajib diisi" }, { status: 400 });
  }
  if (!Array.isArray(loads.loads) || loads.loads.length === 0) {
    return NextResponse.json({ error: "loads harus berisi minimal satu item" }, { status: 400 });
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
    return NextResponse.json({ error: describe(err) }, { status: 500 });
  } finally {
    await fs.rm(tmpdir, { recursive: true, force: true }).catch(() => {});
  }
}

function describe(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  if (e?.code === "ENOENT") {
    return `'${PYTHON}' tidak ditemukan. Endpoint ini butuh Python 3 + dependensi di python/requirements.txt (lihat README: runtime serverless Vercel tidak menyediakan python3).`;
  }
  if (e?.killed) return "Script Python melebihi batas waktu";
  const stderr = e?.stderr?.trim();
  if (stderr) return `Script Python gagal: ${stderr.split("\n").slice(-6).join("\n")}`;
  return err instanceof Error ? err.message : "Generate gagal";
}
