# Notion test-payload guard (live since 11 Nov 2026 13:09 UAE)

Deployed by Claude on Anthony's go to Worker `marketplace-downloads-webhook` (version 9996f521). Bindings and secrets unchanged.

Why: Notion's webhook "Test" button posts a fake download (`customerEmail: test_webhook@notion.so`, `templateName: Test Template`). On 10 Nov this created 2 rows in Marketplace Downloads, the Notion Automation emailed the upgrade offer to the fake address, and Gmail sent delivery-delay notices.

What: right after `templateName` is read in the POST handler, a test payload is acknowledged with 200 and nothing is written or sent (no Resend contact, no Google Sheets row, no Notion row):

```js
if (/^test_webhook@notion\.so$/i.test(String(buyerEmail).trim()) || /^test template$/i.test(String(templateName).trim())) {
  console.log("Notion test payload: acknowledged, nothing written or sent");
  return new Response(JSON.stringify({ success: true, skipped: "notion_test_payload" }), { status: 200, headers: { "Content-Type": "application/json" } });
}
```

**Before the next deploy from this repo:** add the same block to `worker-dropin.js` after `const templateName = ...`, or the guard is lost.
