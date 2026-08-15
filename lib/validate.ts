import type { LoadsFile } from "@/types/loads";

/**
 * The two checks that run over a loads.json, kept side by side because they are
 * easy to confuse and answer different questions.
 *
 * validateLoads() is fatal: these are the fields the Python builders index into
 * directly, so anything it reports would otherwise come back as a KeyError or a
 * division by zero with no indication of what to fix. It gates /api/generate.
 *
 * collectWarnings() is advisory: heuristics about values that are well-formed
 * but suspicious — a kW figure that never got scaled to watts, a fan that came
 * back marked motor:false. It cannot block anything, because only the engineer
 * can say whether a given number is wrong. It runs after extraction.
 *
 * Both return every problem rather than stopping at the first: extraction
 * mistakes and hand-edits usually come in groups, and fixing them one round
 * trip at a time is miserable.
 *
 * python/panel_core.py:validate_loads() repeats the fatal checks for callers
 * that never pass through here — the CLI builders and the serverless function.
 * The duplication is deliberate; each side is the last line for its own callers.
 */

/** Fatal problems. An empty array means the builders can run. */
export function validateLoads(data: unknown): string[] {
  const problems: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["JSON harus berupa objek dengan field 'panel' dan 'loads'"];
  }

  const file = data as Partial<LoadsFile>;

  if (!file.panel?.name?.trim()) problems.push("panel.name wajib diisi");

  if (!Array.isArray(file.loads) || file.loads.length === 0) {
    problems.push("loads harus berupa daftar berisi minimal satu item");
    return problems;
  }

  file.loads.forEach((load, index) => {
    const n = index + 1;
    if (!load || typeof load !== "object" || Array.isArray(load)) {
      problems.push(`Load #${n}: harus berupa objek`);
      return;
    }

    const tag = typeof load.tag === "string" ? load.tag.trim() : "";
    const where = tag ? `Load #${n} (${tag})` : `Load #${n}`;
    if (!tag) problems.push(`${where}: 'tag' wajib diisi`);

    if (typeof load.watt !== "number" || !Number.isFinite(load.watt)) {
      problems.push(`${where}: 'watt' harus berupa angka (terbaca: ${show(load.watt)})`);
    } else if (load.watt <= 0) {
      problems.push(`${where}: 'watt' harus lebih besar dari 0 (terbaca: ${load.watt})`);
    }

    // Absent means single-phase, matching the Python default.
    const phase = load.phase ?? 1;
    if (phase !== 1 && phase !== 3) {
      problems.push(`${where}: 'phase' harus 1 atau 3 (terbaca: ${show(load.phase)})`);
    }

    if (load.qty !== undefined && (!Number.isInteger(load.qty) || load.qty < 1)) {
      problems.push(`${where}: 'qty' harus bilangan bulat >= 1 (terbaca: ${show(load.qty)})`);
    }
  });

  return problems;
}

/**
 * Surfaces everything a human has to look at before the numbers turn into
 * breaker ratings. Extraction is the only AI step in the pipeline and also the
 * only one that can be wrong in a way the deterministic code cannot detect.
 */
export function collectWarnings(data: LoadsFile): string[] {
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
      warnings.push(`${where}: watt tidak valid (${show(l?.watt)})`);
    } else if (l.watt < 10) {
      // Below ~10 W the number is almost always a kW figure that never got scaled.
      warnings.push(`${where}: watt sangat kecil (${l.watt} W) — cek apakah nilainya masih dalam kW`);
    } else if (l.watt > 200_000) {
      warnings.push(`${where}: watt sangat besar (${l.watt} W) — cek per-unit vs total`);
    }
    if (l?.phase !== 1 && l?.phase !== 3) {
      warnings.push(`${where}: phase harus 1 atau 3 (terbaca: ${show(l?.phase)})`);
    }
    if (l?.qty !== undefined && (!Number.isInteger(l.qty) || l.qty < 1)) {
      warnings.push(`${where}: qty tidak valid (${show(l.qty)})`);
    }
    if (/fan|pump|compressor|outdoor|blower|ahu/i.test(`${l?.tag ?? ""} ${l?.desc ?? ""}`) && !l?.motor) {
      warnings.push(`${where}: terlihat seperti motor tapi motor:false — cek sizing breaker`);
    }
  });

  return warnings;
}

/** A value as it appeared, quoted so a string "1000" is distinguishable from 1000. */
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
