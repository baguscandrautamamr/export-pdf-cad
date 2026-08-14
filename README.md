# Panel Schedule Generator

Upload an equipment schedule (PDF/photo) → AI extracts it into structured data →
you review it manually → generate a **Panel Schedule (Excel)** and a **Single Line
Diagram (DXF + PDF preview)**.

## What is AI and what is not

| Stage | AI? | Why |
|---|---|---|
| Document → `loads.json` | ✅ | Needs vision + reasoning to resolve ambiguity (kW vs W, per-unit vs total) |
| R/S/T balancing, breaker sizing, cable sizing | ❌ | Deterministic IEC formulas, pure Python |
| Excel generation | ❌ | `openpyxl` |
| DXF + PDF generation | ❌ | `ezdxf` + `matplotlib` |

AI is called **only** at the extraction stage. Never replace the balancing/sizing
logic with model output — a wrong breaker or cable size is a safety issue, so
those numbers stay deterministic and auditable.

Because extraction is the one fallible step, the app forces a manual review of
the JSON before anything can be generated, and flags suspicious rows (kW/W
mix-ups, ambiguous per-unit vs total, motors marked as non-motors).

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill OLAGON_API_KEY
# NEXTAUTH_SECRET:  openssl rand -base64 32

pip install -r python/requirements.txt --break-system-packages

npm run dev
```

Open http://localhost:3000 → redirected to `/login` → sign in → upload → review →
generate → download.

### Login

Default demo account:

| Field | Value |
|---|---|
| Email / username | `user` |
| Password | `user` |

`.env.local.example` already ships this account as `DEMO_USER_EMAIL=user` plus the
matching bcrypt hash. If both variables are left empty, `npm run dev` still
accepts `user` / `user` through a fallback in `lib/auth.ts` — but only outside
production, so a deployed build cannot silently inherit a password published in
this repository. In production, both variables are required.

To change the password:

```bash
node scripts/hash-password.js "new-password"
# paste the printed DEMO_USER_PASSWORD_HASH line into .env.local
```

The username field is a plain text input, not `type="email"`, so a bare username
like `user` is accepted alongside a real email address.

## Environment variables

| Var | Purpose |
|---|---|
| `OLAGON_API_KEY` | Olagon client proxy key (`rk_live_...`) |
| `OLAGON_BASE_URL` | Default `https://gateway.olagon.site/anthropic` |
| `OLAGON_MODEL` | Default `claude-sonnet-4-6` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000`, production domain when deployed |
| `DEMO_USER_EMAIL` | Demo login email/username (example ships `user`) |
| `DEMO_USER_PASSWORD_HASH` | bcrypt hash from `scripts/hash-password.js`; escape `$` as `\$` in `.env.local` |
| `PYTHON_BIN` | Optional, Python interpreter for `/api/generate` (default `python3`) |

## `loads.json` contract

The single interface between AI extraction and the Python engineering core.
Only `panel.name` and `loads` are required; everything under `system` defaults
(400/230 V, PF 0.8, 40 °C ambient, 20 % spare, 3 spare circuits).

```json
{
  "panel": { "name": "PP-HVAC E_RAW MATERIAL", "group": "HVAC" },
  "system": { "voltage_ll": 400, "pf": 0.8 },
  "loads": [
    { "tag": "IU E-001", "desc": "LABEL STORAGE", "watt": 300, "phase": 1, "qty": 2 },
    { "tag": "OU E-001.M1", "desc": "OUTDOOR UNIT", "watt": 12820, "phase": 3, "motor": true }
  ]
}
```

`watt` is always **per unit and in watts** — `qty` splits into one breaker per
unit downstream, so never pre-multiply.

The TypeScript mirror lives in `types/loads.ts`; `lib/sample.ts` holds a full
worked example that the UI can load without spending a gateway call.

## API

Both routes call `getServerSession()` and return JSON `401` when signed out.
`middleware.ts` deliberately excludes `/api/*` so these get a readable JSON body
rather than an HTML redirect.

- `POST /api/extract` — `multipart/form-data` with `file` (PDF or PNG/JPEG/WEBP/GIF,
  15 MB max) → `{ loads, warnings }`.
- `POST /api/generate` — `{ loads }` → `{ summary, files: [{name, mime, base64}] }`.
  Writes `loads.json` to a temp dir, runs both Python builders, reads back
  whatever they wrote, and always removes the temp dir.

## Python core

`python/panel_core.py`, `build_xlsx.py`, `build_dxf.py` come from the internal
`panel-schedule-cad` skill. Refer to that skill's `references/engineering.md`
before changing any engineering formula — don't adjust balancing or sizing rules
ad hoc.

Run standalone:

```bash
python3 python/build_xlsx.py python/loads_example.json ./out
python3 python/build_dxf.py  python/loads_example.json ./out
```

Output names are always `PANEL_SCHEDULE_<sanitised panel name>.{xlsx,dxf,pdf}`.

## ⚠️ Deployment: `/api/generate` needs Python

Vercel's Node.js serverless runtime does **not** provide `python3`. This route
works under `npm run dev` and on any host with Python available, but will fail on
a plain Vercel deploy. Three ways out, still undecided:

1. Move the Python into a Vercel Python Serverless Function (`@vercel/python`),
   called from this route over an internal `fetch`.
2. Deploy `python/` as a separate HTTP service (Railway/Render/Fly.io) and make
   this route a proxy.
3. Port `panel_core.py` / `build_xlsx.py` / `build_dxf.py` to TypeScript — most
   work, simplest single-runtime deploy.

The route reports a clear error if the interpreter is missing rather than failing
opaquely, but this decision has to be made before calling generate "done" on
Vercel.

## Olagon gateway

`gateway.olagon.site` is a **third-party commercial proxy** with an
Anthropic-compatible API format, not an Anthropic service. Uploaded documents —
including client project data — transit Olagon's servers, its security claims are
self-reported, and it bills separately on a rolling quota. Reading its Terms of
Service and Privacy Policy before putting real client documents through it is
still an open item.

Nothing in `lib/olagon-client.ts` is Olagon-specific beyond the `x-api-key`
header, so pointing `OLAGON_BASE_URL` at Anthropic directly (or another
compatible endpoint) is a config change, not a code change.

## Status

Done:

- Next.js 15 App Router + TypeScript
- NextAuth login (env demo user) + route protection
- i18n ID/EN, light/dark theme, glassmorphism UI, PWA
- `/api/extract` and `/api/generate`, manual JSON review before generate

Open:

- Replace the demo login with a real multi-user database
- Pick a Python deployment strategy for Vercel (three options above)
- Per-user project history (needs a database)
- Verify Olagon's ToS & privacy policy
