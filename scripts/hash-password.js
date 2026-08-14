#!/usr/bin/env node
/**
 * Generates the bcrypt hash for DEMO_USER_PASSWORD_HASH.
 *
 *   node scripts/hash-password.js "kata-sandi-anda"
 *
 * Catatan penting soal tanda '$':
 * Next.js memuat .env.local lewat dotenv-expand, jadi '$2a', '$12', dst di
 * dalam hash bcrypt diperlakukan sebagai variabel dan nilainya jadi kosong —
 * login lalu selalu gagal tanpa pesan error yang jelas. Tanda kutip tunggal
 * TIDAK menolong; yang menolong hanya escape '\$'. Karena itu skrip ini
 * mencetak dua bentuk: yang sudah di-escape untuk .env.local, dan hash mentah
 * untuk dashboard (Vercel dll) yang menyimpan nilai apa adanya.
 */
const bcrypt = require("bcryptjs");

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "<password>"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

console.log("\n# Untuk .env.local (tanda $ sudah di-escape):");
console.log(`DEMO_USER_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
console.log("\n# Untuk dashboard hosting (Vercel dll), tempel nilai mentah ini:");
console.log(hash);
