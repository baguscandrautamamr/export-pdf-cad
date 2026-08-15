import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  callOlagon,
  parseJsonFromModel,
  type ContentBlock,
} from "@/lib/olagon-client";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_INSTRUCTION } from "@/lib/prompts";
import { collectWarnings } from "@/lib/validate";
import type { LoadsFile } from "@/types/loads";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
// Passed explicitly rather than left to the client default, so the truncation
// check below and the budget it checks against can never drift apart.
const MAX_OUTPUT_TOKENS = 8000;
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
  let stats;
  try {
    const reply = await callOlagon({
      system: EXTRACTION_SYSTEM_PROMPT,
      content,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    stats = reply.stats;
    // Checked before parsing, because a truncated list is the one failure that
    // can look like a success: the JSON may still parse, just with rows missing,
    // and a panel schedule that is quietly short is worse than one that errors.
    if (stats.stopReason === "max_tokens") {
      throw new Error(
        `Jawaban model terpotong di batas ${MAX_OUTPUT_TOKENS} token (stop_reason=max_tokens), jadi ` +
          `daftar load-nya hampir pasti tidak lengkap. Schedule ini terlalu panjang untuk ` +
          `satu permintaan — pecah PDF-nya per panel dan ekstrak satu per satu.`
      );
    }
    loads = parseJsonFromModel<LoadsFile>(reply.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ekstraksi gagal";
    // Name the document too. Every other number in the message describes the
    // call; without this one there is nothing to weigh them against, and "the
    // document is too heavy" is a claim the reader cannot check.
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { error: `${message} [dokumen: ${file.name}, ${mb} MB, ${mime}]` },
      { status: 502 }
    );
  }

  // Returned on success too, so a call that only just made it inside the budget
  // is visible before it starts failing — the run before the first timeout is
  // the one that would have warned you.
  return NextResponse.json({ loads, warnings: collectWarnings(loads), stats });
}
