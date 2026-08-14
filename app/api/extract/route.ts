import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  callOlagon,
  parseJsonFromModel,
  type ContentBlock,
} from "@/lib/olagon-client";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_INSTRUCTION } from "@/lib/prompts";
import type { LoadsFile } from "@/types/loads";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(req: Request) {
  // Middleware deliberately skips /api/*, so the 401 is ours to return — a JSON
  // body rather than an HTML redirect the fetch caller cannot read.
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json(
      { error: "Body harus multipart/form-data dengan field 'file'" },
      { status: 400 }
    );
  }

  if (!file) {
    return NextResponse.json({ error: "Berkas 'file' tidak ada" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Berkas kosong" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Berkas terlalu besar (maks ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  const mime = file.type || "application/octet-stream";
  const isPdf = mime === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.includes(mime)) {
    return NextResponse.json(
      { error: `Tipe berkas tidak didukung: ${mime}. Gunakan PDF atau PNG/JPEG/WEBP/GIF.` },
      { status: 415 }
    );
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const content: ContentBlock[] = [
    isPdf
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mime, data: base64 },
        },
    { type: "text", text: EXTRACTION_USER_INSTRUCTION },
  ];

  let loads: LoadsFile;
  try {
    const text = await callOlagon({ system: EXTRACTION_SYSTEM_PROMPT, content });
    loads = parseJsonFromModel<LoadsFile>(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ekstraksi gagal";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ loads, warnings: collectWarnings(loads) });
}

/**
 * Surfaces everything a human has to look at before the numbers turn into
 * breaker ratings. Extraction is the only AI step in the pipeline and also the
 * only one that can be wrong in a way the deterministic code cannot detect.
 */
function collectWarnings(data: LoadsFile): string[] {
  const warnings: string[] = [];

  if (!data || typeof data !== "object") return ["Hasil ekstraksi bukan objek yang valid"];
  if (!data.panel?.name?.trim()) warnings.push("panel.name kosong — wajib diisi manual");
  if (!Array.isArray(data.loads) || data.loads.length === 0) {
    warnings.push("Tidak ada load yang terbaca");
    return warnings;
  }

  data.loads.forEach((l, i) => {
    const where = `Load #${i + 1} (${l?.tag || "tanpa tag"})`;
    if (l?.remark && /ambigu/i.test(l.remark)) {
      warnings.push(`${where}: ${l.remark}`);
    }
    if (!l?.tag?.trim()) warnings.push(`${where}: tag kosong`);
    if (typeof l?.watt !== "number" || !Number.isFinite(l.watt) || l.watt <= 0) {
      warnings.push(`${where}: watt tidak valid (${String(l?.watt)})`);
    } else if (l.watt < 10) {
      // Below ~10 W the number is almost always a kW figure that never got scaled.
      warnings.push(`${where}: watt sangat kecil (${l.watt} W) — cek apakah nilainya masih dalam kW`);
    } else if (l.watt > 200_000) {
      warnings.push(`${where}: watt sangat besar (${l.watt} W) — cek per-unit vs total`);
    }
    if (l?.phase !== 1 && l?.phase !== 3) {
      warnings.push(`${where}: phase harus 1 atau 3 (terbaca: ${String(l?.phase)})`);
    }
    if (l?.qty !== undefined && (!Number.isInteger(l.qty) || l.qty < 1)) {
      warnings.push(`${where}: qty tidak valid (${String(l.qty)})`);
    }
    if (/fan|pump|compressor|outdoor|blower|ahu/i.test(`${l?.tag ?? ""} ${l?.desc ?? ""}`) && !l?.motor) {
      warnings.push(`${where}: terlihat seperti motor tapi motor:false — cek sizing breaker`);
    }
  });

  return warnings;
}
