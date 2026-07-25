# Deploy — MailerLite → Resend swap

Pulled from Cloudflare July 25, 2026. Verified against your live worker, not assumptions.

---

## What your setup actually looks like

**Two workers exist, not one:**

| Worker | Created | Modified | Status |
|---|---|---|---|
| `notion-mailerlite-webhook` | 2026-06-11 | 2026-06-14 | **Live.** Does both steps: MailerLite + Sheets. |
| `notion-to-gsheet` | 2025-09-14 | 2026-06-10 | **Orphan.** Only posts to the Apps Script URL. Superseded. |

`notion-mailerlite-webhook` already POSTs to the Apps Script URL itself, so `notion-to-gsheet` duplicates step 2. Confirm nothing points at it, then delete it. Two live paths to the same Sheet is how duplicate rows happen.

**Real payload fields** (this is what Notion sends): `customerEmail`, `templateName`. My earlier guesses were wrong; the drop-in matches reality now.

**Resend account state** (checked live): `anthonytoday.com` verified, sending enabled, created July 24. Contacts already imported. Three segments exist: General, Wave 1 — Engaged, Wave 2 — Unengaged. Your account uses the **segments** model, so there is no audience ID to set.

---

## Deploy steps

### 1. Add the Cloudflare variables

Workers & Pages → `notion-mailerlite-webhook` → Settings → Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `RESEND_API_KEY` | Secret | from Resend → API Keys |
| `RESEND_SEGMENT_ID` | Text | `3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe` (General) |

Leave `RESEND_EVENT_NAME` unset. Setting it fires automation triggers, and the automation does not exist yet. That is the next session's work.

Keep `GSHEET_WEBHOOK_URL` exactly as is. Leave the MailerLite variables in place until step 4 passes.

### 2. Paste the code

Edit code → select all → paste `worker-dropin.js` → Deploy.

### 3. Test

```bash
curl -X POST "https://notion-mailerlite-webhook.learningamazonfba.workers.dev/" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"admin@anthonytoday.com","templateName":"Deploy Test","customerName":"Anthony Kieffer"}'
```

Expect `{"success":true,"email":"admin@anthonytoday.com",...}`.

Then confirm all three:

- Resend → Contacts → `admin@anthonytoday.com` present, in the General segment
- The Google Sheet has a new row
- `npx wrangler tail notion-mailerlite-webhook` shows "Successfully added ... to Resend"

Also test the ungated path, which should log a row and create no contact:

```bash
curl -X POST "https://notion-mailerlite-webhook.learningamazonfba.workers.dev/" \
  -H "Content-Type: application/json" \
  -d '{"templateName":"Ungated Test"}'
```

### 4. Clean up (only after step 3 passes)

- Delete `MAILERLITE_API_KEY` and `MAILERLITE_GROUP_ID` variables
- Delete the `notion-to-gsheet` worker
- Rename the worker to `notion-resend-webhook` **only if** you are ready to update the webhook URL in your Notion profile at the same time. Renaming changes the URL and breaks the hook until Notion is updated. Low value, real risk: recommend leaving the name alone.

---

## Changes vs the original

| # | Change | Why |
|---|---|---|
| 1 | MailerLite subscriber POST → Resend contact POST | The swap |
| 2 | Optional segment attachment | Your account uses segments |
| 3 | Optional automation event, inert until `RESEND_EVENT_NAME` is set | Keeps emails out of scope today |
| 4 | Missing email returns **200 skipped**, was **400** | A 400 tells Notion the hook failed and can trip retry or auto-disable. Ungated downloads are normal, not errors. |
| 5 | Sheets step moved ahead of the email guard | Every download now logs, gated or not, so reporting stays complete when you open capture to all templates |
| 6 | 409 treated as success | Repeat downloader, not a failure |

Change 5 is the one that matters for the strategy shift: your Sheet becomes a complete download log rather than an email-capture log.

---

## Rollback

`baseline/notion-mailerlite-webhook.ORIGINAL.js` is the exact code that was live. Paste it back and re-add the MailerLite variables.

---

## Autonomous maintenance going forward

The Cloudflare connector is **read-only for worker code** (`workers_list`, `workers_get_worker`, `workers_get_worker_code`). There is no deploy tool, so I cannot push code to Cloudflare myself.

To let me deploy without you pasting:

1. Push this folder to GitHub
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets
3. `.github/workflows/deploy.yml` then deploys on every push to `main`

I maintain the files here, you push, GitHub deploys. I can still read live worker state through the connector to verify what actually shipped.
