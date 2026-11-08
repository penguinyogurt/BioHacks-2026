# Deploying Addo Labs: Vercel (frontend) + Vultr (backend)

```
browser ──https──► Vercel: frontend/ (the app, plus the take-home test at /take-home/)
   │                    │
   │                    └── Supabase (auth, reports, take-home results): called directly by the browser
   └──https──► Vultr: backend/ (FastAPI, :8001 behind Caddy)
                 /api/research · /api/drkg · /api/assess   the discovery pipeline
                 /api/diagnostics/{facial,speech}          take-home test scoring
```

Everything below was written on 2026-11-08 and checked locally, not against a live deploy.
Do one full run on the deployed site before relying on it.

## 1. Backend on Vultr

Ubuntu 24.04, at least 4 GB RAM (PyTorch + the POSTER++ model + DRKG). No GPU needed.

```bash
sudo apt update && sudo apt install -y python3-venv git unzip curl caddy
git clone <repo> addo && cd addo/backend
python3 -m venv .venv
.venv/bin/pip install -r agent/requirements.txt -r diagnostics/requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu
cp agent/.env.example agent/.env      # fill in ANTHROPIC_API_KEY etc., and:
#   AGENT_CORS_ORIGINS=https://<your-app>.vercel.app   (and any custom domain)
```

**Take-home test models** (the scripts also make their own small venvs; harmless):

```bash
bash diagnostics/facial-test/setup.sh          # POSTER++ checkpoint + face detector → facial-test/assets/
bash diagnostics/speech-test-good/setup.sh     # Vosk model → speech-test-good/private/speech_demo/
```

The speech script's last step (`make_samples.py`, reference voices) uses macOS `say` and fails on
Linux; that only removes the "play the reference" button on the review screen. Scoring works.
Check with `curl localhost:8001/api/diagnostics/health` once the API runs: both should be `true`.

**DRKG data** (stage 3), 217 MB, into `backend/.venv/data/drkg/`: the commands are in
`agent/.env.example` under "Stage 3".

**Run it** as a service (`/etc/systemd/system/addo-api.service`):

```ini
[Service]
WorkingDirectory=/home/<user>/addo/backend
ExecStart=/home/<user>/addo/backend/.venv/bin/python -m agent.api
Restart=always
User=<user>
[Install]
WantedBy=multi-user.target
```

It binds `127.0.0.1:8001` only. **Never `uvicorn --reload`** (breaks the agent's subprocesses).

**HTTPS with Caddy** (`/etc/caddy/Caddyfile`); point a DNS A record at the server first:

```
api.<your-domain> {
    reverse_proxy 127.0.0.1:8001
}
```

`sudo systemctl enable --now addo-api caddy`. Caddy gets the certificate itself. HTTPS is not
optional: the Vercel site is HTTPS, and browsers block calls from it to an `http://` backend.

## 2. Frontend on Vercel

- **Root directory:** `frontend` · framework Vite · build `npm run build` · output `dist`.
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_AGENT_URL=https://api.<your-domain>`. Leave `VITE_TAKE_HOME_URL` unset.
- `frontend/vercel.json` rewrites app routes (`/home/...`) to the SPA, so reloading a page works;
  real files, including `/take-home/`, are served first.

## 3. Supabase

- **Auth → URL configuration:** add `https://<your-app>.vercel.app/home` (and custom domains) to the
  redirect URLs, and set the site URL, or Google sign-in returns to localhost.
- The schema is already applied; it's recorded in `frontend/supabase/migrations/`.

## The take-home test

`https://<your-app>/take-home/index.html`, opened from the app's **Take-home test** tab (or a copied
link). The link carries a one-time code; on completion the test saves results straight to Supabase
(`submit_take_home`), so it works on any device, signed in or not. The pages are copies of
`backend/diagnostics/*`: after editing those, run `npm run sync:take-home` in `frontend/` and
commit `frontend/public/take-home/`. Locally, the original launcher still works
(`python backend/diagnostics/master-app/diagnostic_complete.py`).
