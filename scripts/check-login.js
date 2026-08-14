#!/usr/bin/env node
/**
 * Melaporkan kredensial login yang benar-benar dilihat server.
 *
 *   npm run check-login              -> cek konfigurasi
 *   npm run check-login -- "sandi"   -> sekalian uji satu kata sandi
 *
 * Dibuat karena kegagalan login yang paling sering terjadi tidak kelihatan:
 * Next membaca .env.local lewat dotenv-expand, jadi '$' pada hash bcrypt yang
 * tidak di-escape dibaca sebagai nama variabel dan nilainya jadi kosong.
 */
const { loadEnvConfig } = require("@next/env");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

loadEnvConfig(process.cwd(), true);

const BCRYPT = /^\$2[aby]?\$\d{2}\$/;
const email = process.env.DEMO_USER_EMAIL?.trim();
const hash = process.env.DEMO_USER_PASSWORD_HASH?.trim();
const plain = process.env.DEMO_USER_PASSWORD;
const envPath = path.join(process.cwd(), ".env.local");

const line = (k, v) => console.log(`  ${k.padEnd(28)} ${v}`);

console.log("\nKONFIGURASI LOGIN\n");
line(".env.local", fs.existsSync(envPath) ? "ada" : "tidak ada");
line("DEMO_USER_EMAIL", email ? `"${email}"` : "(kosong)");
line(
  "DEMO_USER_PASSWORD_HASH",
  !hash ? "(kosong)" : BCRYPT.test(hash) ? `terbaca (${hash.slice(0, 7)}...)` : `RUSAK: "${hash}"`
);
line("DEMO_USER_PASSWORD", plain ? "terisi (teks biasa)" : "(kosong)");

const hashOk = !!hash && BCRYPT.test(hash);
const usable = !!email && (hashOk || !!plain);

console.log("\nBISA LOGIN DENGAN\n");
if (usable) {
  line(`${email} / <kata sandi Anda>`, hashOk ? "dari hash bcrypt" : "dari DEMO_USER_PASSWORD");
} else {
  line("(akun environment)", "tidak aktif - konfigurasi belum lengkap/rusak");
}
line("user / user", "hanya di npm run dev, ditolak di production");

if (hash && !BCRYPT.test(hash)) {
  console.log(
    "\nMASALAH: hash tidak terbaca sebagai bcrypt.\n" +
      "Di .env.local, tanda $ WAJIB di-escape jadi \\$ karena Next memakai\n" +
      "dotenv-expand. Contoh baris yang benar:\n\n" +
      "  DEMO_USER_PASSWORD_HASH=\\$2a\\$12\\$abcdef...\n\n" +
      'Buat baris baru dengan: node scripts/hash-password.js "kata-sandi"\n'
  );
}

const probe = process.argv[2];
if (probe) {
  console.log("\nUJI KATA SANDI\n");
  line(
    "cocok dengan hash bcrypt?",
    hashOk ? (bcrypt.compareSync(probe, hash) ? "YA" : "TIDAK") : "tidak ada hash"
  );
  line(
    "cocok dengan DEMO_USER_PASSWORD?",
    plain ? (probe === plain ? "YA" : "TIDAK") : "tidak diset"
  );
  line("cocok dengan akun dev?", probe === "user" ? "YA (username: user)" : "TIDAK");
}

console.log(
  "\nCatatan: `npm run dev` menerima akun dev di atas; `npm run build && npm start`\n" +
    "berjalan sebagai production sehingga HANYA menerima akun dari environment.\n"
);
