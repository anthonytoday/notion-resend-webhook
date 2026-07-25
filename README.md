# notion-download-webhook

Cloudflare Worker that receives a Notion Marketplace template-download webhook and:

1. Creates/updates the contact in **Resend** (replaces MailerLite)
2. Fires the **Resend Automation** trigger event that starts the 7-email chain
3. Appends a reporting row to the **Google Sheet**

Source lives in GitHub. Every push to `main` auto-deploys to Cloudflare. No more editing code in the Cloudflare dashboard.

---

## Why Resend can replace MailerLite entirely

Resend shipped **Automations** on April 13, 2026: event trigger → time delay → send template → branch → repeat. That is the piece that used to be missing. The worker fires one event; Resend runs the whole 21-day sequence.

---

## Repo layout

```
worker-dropin.js                THE WORKER. This is what deploys.
wrangler.toml                   worker name, compatibility date, non-secret vars
_test-dropin.mjs                local test harness, no network needed (npm test)
baseline/                       snapshots of the pre-Resend workers, for rollback
apps-script/Code.gs             reference copy of the Sheets receiver
docs/resend-automation-spec.md  the 7-email chain mapped to Resend steps (later work)
DEPLOY.md                       deploy runbook + what changed vs baseline
.github/workflows/deploy.yml    disabled fallback; Cloudflare Workers Builds deploys
```

Deployment is via **Cloudflare Workers Builds**: the Worker's Settings → Build tab
watches this repo and rebuilds on every push to `main`.

---

## Setup

### 1. Push to GitHub

```bash
cd "Notion HQ/notion-download-webhook"
git init
git add .
git commit -m "Resend + Sheets download webhook"
git branch -M main
git remote add origin git@github.com:<your-user>/notion-download-webhook.git
git push -u origin main
```

### 2. Cloudflare API token

Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template. Copy the token and your Account ID.

### 3. GitHub repo secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 2 |
| `WEBHOOK_SECRET` | a long random string you generate |
| `RESEND_API_KEY` | Resend → API Keys (sending + contacts permission) |
| `SHEETS_WEBAPP_URL` | the Apps Script `/exec` URL (see step 4) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | only if using `service_account` mode, else set to a space |
| `GOOGLE_PRIVATE_KEY` | only if using `service_account` mode, else set to a space |

### 4. Google Sheets receiver

Open the reporting Sheet → Extensions → Apps Script → paste `apps-script/Code.gs` → set `SHARED_SECRET` to the same value as `WEBHOOK_SECRET` → Deploy → New deployment → Web app (Execute as: Me, Access: Anyone) → copy the `/exec` URL into `SHEETS_WEBAPP_URL`.

Alternative: set `SHEETS_MODE = "service_account"` in `wrangler.toml`, fill `SHEET_ID`, and share the Sheet with the service account email as Editor.

### 5. Resend

Follow `docs/resend-automation-spec.md`: verify the sending domain, create the `template.downloaded` event, build the 7 templates and the automation, publish.

### 6. Point Notion at the worker

Webhook URL:

```
https://notion-download-webhook.<your-subdomain>.workers.dev/notion-download?token=<WEBHOOK_SECRET>
```

Prefer the header form when the sender supports it: `X-Webhook-Secret: <WEBHOOK_SECRET>`.

---

## Verifying

```bash
# health
curl https://notion-download-webhook.<sub>.workers.dev/health

# simulated download
curl -X POST "https://notion-download-webhook.<sub>.workers.dev/notion-download" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <WEBHOOK_SECRET>" \
  -d '{"email":"you@anthonytoday.com","name":"Test User","template_name":"Ultimate Content Manager","category":"business"}'

# watch live logs (shows the raw payload while LOG_RAW_PAYLOAD=true)
npx wrangler tail
```

The response reports each step independently, so a Sheets failure is visible even when Resend succeeded.

---

## Config reference (`wrangler.toml` vars)

| Var | Purpose |
|---|---|
| `RESEND_EVENT_NAME` | must match the Automation trigger |
| `RESEND_AUDIENCE_ID` | optional; empty uses the flat `/contacts` endpoint |
| `SHEETS_MODE` | `apps_script` or `service_account` |
| `CAPTURE_SCOPE` | `all` = every download enrolls; `list` = only `TEMPLATE_ALLOWLIST` matches |
| `TEMPLATE_ALLOWLIST` | comma-separated substrings matched against template name/id/category |
| `LOG_RAW_PAYLOAD` | `true` while confirming the Notion payload shape, then set `false` |

`CAPTURE_SCOPE` is the switch for the strategy shift. Sheets logs every download either way, so reporting is never affected by the scope choice.

---

## Two things to confirm before go-live

1. **The real Notion payload shape.** The parser handles ~20 common field names plus a deep scan for anything matching an email pattern, but the actual field names should be confirmed from `wrangler tail` on a real download.
2. **How the current worker writes to Sheets.** If the existing one uses a service account rather than an Apps Script Web App, switch `SHEETS_MODE` and reuse the existing credentials rather than creating new ones.
