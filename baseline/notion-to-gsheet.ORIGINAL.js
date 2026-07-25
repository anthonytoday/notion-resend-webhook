/**
 * BASELINE SNAPSHOT — pulled from Cloudflare 2026-07-25 via the Cloudflare MCP connector.
 * Worker: notion-to-gsheet  (id 36aa151ed5d64fdab4e233b44c0785de)
 * Created 2025-09-14, last modified 2026-06-10 (four days BEFORE notion-mailerlite-webhook).
 *
 * STATUS: almost certainly superseded. notion-mailerlite-webhook already posts to the
 * Apps Script URL itself, so this worker duplicates step 2. Verify nothing points at it,
 * then delete it. Keeping two live paths to the same Sheet risks duplicate rows.
 *
 * NOTE: the Apps Script URL is hardcoded here rather than held as a secret.
 *
 * DO NOT EDIT. Rollback copy only.
 */

export default {
  async fetch(request) {
    if (request.method === "POST") {
      const body = await request.json();

      // Send to Google Sheets
      await fetch("https://script.google.com/macros/s/AKfycbyfYEPZMyVqdu0-9rBlNX2aNriPwKZYMjx3JTylW2dF3YIxr1d3E4zu6BRamhp3UJ9L/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).catch(e => console.error("GSheet error:", e));

      return new Response("OK", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  }
}
