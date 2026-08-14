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

Under `npm run dev` this account works **always** — whatever `.env.local` says,
even if it is missing, stale or broken. That is deliberate: a wrong
`DEMO_USER_*` value should never lock you out of your own dev server.

`NODE_ENV=production` (i.e. `npm run build && npm start`, and every real
deployment) **refuses** it and accepts only the account from the environment, so
a password published in this repository can never authenticate a deployed app.

Any account you configure keeps working alongside it. There are two ways to
configure one — pick either:

```bash
# 1. Plaintext. No hashing, and the only option that needs no extra step.
DEMO_USER_EMAIL=user
DEMO_USER_PASSWORD=user

# 2. bcrypt hash. Stronger, and what you want for anything real.
node scripts/hash-password.js "new-password"
# paste the printed DEMO_USER_PASSWORD_HASH line into .env.local
```

A valid `DEMO_USER_PASSWORD_HASH` always wins and makes `DEMO_USER_PASSWORD`
inert, so a leftover plaintext value can never become a second accepted
password.

If a login is rejected and you want to know why:

```bash
npm run check-login              # what the server actually sees
npm run check-login -- "secret"  # also test one password against the hash
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
| `DEMO_USER_PASSWORD` | Plaintext password. Simplest option, no hashing. Ignored when a valid hash is set |
| `DEMO_USER_PASSWORD_HASH` | bcrypt hash from `scripts/hash-password.js`; escape `$` as `\$` in `.env.local`. Takes precedence over `DEMO_USER_PASSWORD` |
| `PYTHON_BIN` | Optional, Python interpreter for `/api/generate` (default `python3`) |
| `INTERNAL_API_SECRET` | Shared secret between `/api/generate` and the Python function. Required wherever the Python side runs out-of-process (Vercel included) |
| `PYTHON_SERVICE_URL` | Optional. URL of the Python builder when it is deployed as its own service. Unset on Vercel — the route defaults to `/api/build` in the same deployment |

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

## Deploy to Vercel

Vercel's Node.js runtime has no `python3`, so the builders run as a **separate
Python serverless function** (`api/build.py`, the `@vercel/python` runtime).
`/api/generate` stays the front door — it holds the session check — and proxies
to that function. Locally, with no service URL configured, it still spawns
`python3` directly, so `npm run dev` is unchanged.

```
browser → /api/generate (Node, checks session) → /api/build (Python, builds files)
```

### Deploying with the CLI

```bash
npm i -g vercel
vercel login
vercel link                       # once, to create/attach the project

# secret the two functions share; the Python one rejects calls without it
openssl rand -hex 32              # copy the output

vercel env add INTERNAL_API_SECRET production   # paste the value above
vercel env add NEXTAUTH_SECRET production       # openssl rand -base64 32
vercel env add NEXTAUTH_URL production          # https://<your-domain>
vercel env add DEMO_USER_EMAIL production           # e.g. user
vercel env add DEMO_USER_PASSWORD production        # e.g. user (plaintext, no hashing)
vercel env add OLAGON_API_KEY production

vercel --prod
```

Things that bite:

- `NEXTAUTH_URL` must match the deployed domain, or sign-in redirects break.
- If you use `DEMO_USER_PASSWORD_HASH` instead, paste the **raw** hash without
  the `\$` escaping that `.env.local` needs — dashboard and CLI values are
  stored literally.
- A deployed site whose password is `user` is open to anyone who finds the URL.
  Fine for a demo; give it a real password before any client document goes
  through it.

`PYTHON_SERVICE_URL` is not needed on Vercel: the route defaults to `/api/build`
in the same deployment. Set it only when the Python side is deployed elsewhere
(option 2 below) — the code path is identical.

### Known risks on Vercel

I have not been able to run the actual Vercel build, so these are unverified:

- **Function size.** `openpyxl + ezdxf + matplotlib` measures ~204 MB installed,
  against Vercel's 250 MB uncompressed limit. If the build is rejected for size,
  drop `matplotlib` from `api/requirements.txt` — that saves ~67 MB and
  `build_dxf.py` already skips the PDF preview gracefully when it is absent, so
  you still get the xlsx and dxf.
- **Deployment Protection.** If Vercel Authentication is enabled (the default on
  preview deployments), the internal call from `/api/generate` to `/api/build`
  hits the auth wall and fails. Either disable it for the environment, or use
  Protection Bypass for Automation.
- **Cold starts.** The Python function imports matplotlib; first request after
  idle will be slow.

### The other two options

Both remain available without code changes:

2. **Python as its own service** (Railway/Render/Fly.io): deploy `api/build.py` +
   `python/` there, then set `PYTHON_SERVICE_URL` and `INTERNAL_API_SECRET`. Best
   if the function size limit becomes a problem.
3. **Port the builders to TypeScript**: most work, but a single runtime and no
   inter-function hop.

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
- Vercel deploy path for the Python builders (`api/build.py` + proxy)
- i18n ID/EN, light/dark theme, glassmorphism UI, PWA
- `/api/extract` and `/api/generate`, manual JSON review before generate

Open:

- Replace the demo login with a real multi-user database
- Per-user project history (needs a database)
- Verify Olagon's ToS & privacy policy
