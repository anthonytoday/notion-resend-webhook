/**
 * notion-mailerlite-webhook — Resend edition
 *
 * DROP-IN REPLACEMENT for the live worker. Paste this whole file over worker.js in
 * Cloudflare (Workers & Pages -> notion-mailerlite-webhook -> Edit code -> Deploy).
 *
 * Built directly on your existing worker. Structure, logging, and the Google Sheets
 * step are unchanged. Diff vs baseline/notion-mailerlite-webhook.ORIGINAL.js:
 *
 *   1. MailerLite subscriber POST  ->  Resend contact POST
 *   2. Optional Resend event POST  ->  starts the Automation (inert until you set
 *                                      RESEND_EVENT_NAME; leave unset for now)
 *   3. Missing email now returns 200 "skipped" instead of 400, so ungated template
 *      downloads do not look like failures to Notion and cannot trip its retry logic
 *   4. Env var guards updated to the Resend vars
 *
 * ENV VARS
 *   RESEND_API_KEY       (secret)   required
 *   GSHEET_WEBHOOK_URL   (secret)   required, unchanged
 *   RESEND_SEGMENT_ID    (plain)    optional. Your account uses the segments model
 *                                   (not audiences). "General" = 3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe
 *   RESEND_EVENT_NAME    (plain)    optional, e.g. "template.downloaded" — leave unset
 *                                   until the Resend Automation is built and published
 *   NOTION_TOKEN         (secret)   optional. Internal integration token (ntn_...).
 *                                   Unset = the Notion step is skipped silently.
 *   NOTION_DB_ID         (plain)    optional. Marketplace Downloads database id.
 *
 * NOTION STEP (added July 29, 2026)
 *   Third independent sink alongside Resend and Google Sheets. One row per download,
 *   written for EVERY download including ungated ones with no email, mirroring the
 *   Sheets design rule. It runs after the Resend call so it can record the outcome,
 *   which is what makes the silent-422 class of bug visible in Notion rather than
 *   only in the Cloudflare logs. A Notion failure never blocks Resend or Sheets.
 *
 * Remove MAILERLITE_API_KEY and MAILERLITE_GROUP_ID only after verifying this works.
 */

/**
 * Notion has three constraints worth knowing, all of which return 400 rather than
 * degrading gracefully, so each is handled explicitly below:
 *   - a select option name cannot contain a comma
 *   - a select option name is capped at 100 characters
 *   - a rich_text chunk is capped at 2000 characters
 * Template titles are author-supplied, so any of the three could be tripped by a
 * listing rename long after this ships.
 */
const NOTION_VERSION = '2022-06-28';

/**
 * The live marketplace payload, confirmed from production traffic July 29, 2026:
 *
 *   { acquisitionId, time, customerEmail, productType, templateName, templateSlug,
 *     name, slug, discountedPrice, listingPrice, couponCode, event, locale,
 *     source, totalCustomerPayment }
 *
 * This is much richer than the three fields the runbook documented in July, so
 * every field above is now mapped to a property rather than only surviving inside
 * Raw Payload. Two fields the webhook does NOT carry are Tax Amount and Seller
 * Transfer, which exist only in the CSV export, so those stay blank on webhook
 * rows by design.
 *
 * Notion returns 400 rather than degrading on three input rules, all handled below:
 *   - a select option name cannot contain a comma
 *   - a select option name is capped at 100 characters
 *   - a rich_text chunk is capped at 2000 characters
 */

function selectName(value, fallback) {
  const clean = String(value || '').replace(/,/g, ' ').trim().slice(0, 100);
  return clean || fallback;
}

function richText(value, limit = 2000) {
  return [{ text: { content: String(value == null ? '' : value).slice(0, limit) } }];
}

/** First non-empty string among the candidates. */
function firstOf(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

/** Notion rejects NaN on a number property; null clears it instead. */
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * payload.time is epoch milliseconds and is the moment the download actually
 * happened, which is strictly better than the moment the webhook reached us.
 * Falls back to arrival time if it is missing or implausible.
 */
function downloadTimestamp(payload, arrivalIso) {
  const ms = Number(payload && payload.time);
  if (!Number.isFinite(ms) || ms <= 0) return arrivalIso;
  const when = new Date(ms);
  const year = when.getUTCFullYear();
  if (Number.isNaN(when.getTime()) || year < 2015 || year > 2100) return arrivalIso;
  return when.toISOString();
}

/**
 * Append one row to the Marketplace Downloads database.
 * Resolves to a short status string; never throws.
 */
async function writeNotionRow(env, { payload, buyerEmail, templateName, resendStatus, timestamp }) {
  if (!env.NOTION_TOKEN || !env.NOTION_DB_ID) {
    console.log('NOTION_TOKEN or NOTION_DB_ID not set, skipping Notion row');
    return 'skipped_not_configured';
  }

  const raw = payload || {};
  const slug        = firstOf(raw.templateSlug, raw.slug, raw.product_slug);
  const productType = firstOf(raw.productType, raw.product_type);
  const locale      = firstOf(raw.locale);
  const channel     = firstOf(raw.source);
  const coupon      = firstOf(raw.couponCode, raw.coupon_code);
  const acquisition = firstOf(raw.acquisitionId, raw.acquisition_id);

  const properties = {
    'Downloader': { title: richText(buyerEmail || '(no email shared)') },
    'Template': { select: { name: selectName(templateName, 'unknown') } },
    'Downloaded At': { date: { start: downloadTimestamp(raw, timestamp) } },
    'Email Shared': { checkbox: Boolean(buyerEmail) },
    'Source': { select: { name: 'notion-marketplace' } },
    'Record Origin': { select: { name: 'webhook' } },
    'Resend Status': { select: { name: resendStatus } },
    'Listing Price': { number: numberOrNull(raw.listingPrice) },
    'Discounted Price': { number: numberOrNull(raw.discountedPrice) },
    'Customer Payment': { number: numberOrNull(raw.totalCustomerPayment) },
    'Raw Payload': { rich_text: richText(JSON.stringify(raw)) },
  };

  // Empty strings are rejected outright by the email, select and rich_text-backed
  // property types, so each optional field is only attached when it has a value.
  if (buyerEmail)   properties['Email']          = { email: buyerEmail };
  if (slug)         properties['Product Slug']   = { rich_text: richText(slug) };
  if (acquisition)  properties['Acquisition ID'] = { rich_text: richText(acquisition) };
  if (coupon)       properties['Coupon Code']    = { rich_text: richText(coupon) };
  if (productType)  properties['Product Type']   = { select: { name: selectName(productType, 'Template') } };
  if (locale)       properties['Locale']         = { select: { name: selectName(locale, '') } };
  if (channel)      properties['Channel']        = { select: { name: selectName(channel, '') } };

  // The webhook only ever fires on a completed acquisition, so Status is inferred
  // from the event name. Refunds never arrive this way: they show up only in the
  // CSV export, so this column can go stale and is reconciled from the export.
  if (firstOf(raw.event) === 'marketplace.purchase') {
    properties['Status'] = { select: { name: 'Succeeded' } };
  }

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({ parent: { database_id: env.NOTION_DB_ID }, properties }),
    });

    if (!response.ok) {
      // 404 here almost always means the database was never shared with the
      // integration, not that the id is wrong. Notion returns 404 for both.
      console.error(`Notion error: ${response.status} - ${await response.text()}`);
      return 'failed';
    }

    console.log(`Notion row created for ${buyerEmail || '(no email)'} / ${templateName}`);
    return 'created';
  } catch (error) {
    console.error('Error calling Notion:', error.message);
    return 'failed';
  }
}

export default {
  async fetch(request, env, ctx) {
    const method = request.method;
    const url = new URL(request.url);

    console.log(`[${new Date().toISOString()}] ${method} ${url.pathname}`);

    // Handle Notion's TEST request (might be GET or HEAD)
    if (method === 'GET' || method === 'HEAD') {
      console.log('Received test/health check');
      return new Response(JSON.stringify({
        status: 'ok',
        message: 'Webhook receiver is working (Resend)'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle real webhook (POST)
    if (method !== 'POST') {
      console.error(`Rejected ${method} request`);
      return new Response(JSON.stringify({ error: 'Only POST, GET, HEAD allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const payload = await request.json();
      console.log('Received POST payload:', JSON.stringify(payload));

      // Notion sends customerEmail / templateName. Fallbacks kept in case the
      // marketplace payload shape differs on non-gated or newer listings.
      const buyerEmail = payload.customerEmail || payload.email || '';
      const templateName = payload.templateName || payload.template || 'unknown';

      // NAME HANDLING — fixed July 26, 2026.
      //
      // Notion's marketplace payload carries NO buyer name. It does send a top-level
      // `name` field, but that holds the TEMPLATE title. The old fallback chain
      // (`payload.customerName || payload.name`) therefore wrote template titles into
      // the contact's name, e.g. first_name "Simple" / last_name "Student Planner 2026
      // - Ace Your Classes". Any {{ first_name }} token in the email chain would then
      // render as a fragment of a product title.
      //
      // `payload.name` is now excluded outright, and whatever survives is checked
      // against the template title before it is accepted. Empty is correct and safe:
      // greetings in the chain are name-optional ("Hey,") and personalization runs on
      // the template_purchased property instead, which is populated reliably.
      // One timestamp shared by the Resend property and the Notion row, so the two
      // systems never disagree about when a download happened.
      const eventTimestamp = new Date().toISOString();

      const norm = (s) => String(s || '').trim().toLowerCase();
      const rawName = payload.customerName || payload.buyerName || payload.customer_name || '';

      let customerName = String(rawName || '').trim();
      if (customerName && norm(customerName) === norm(templateName)) {
        console.warn(`Discarding name "${customerName}" — it matches the template title`);
        customerName = '';
      }
      if (customerName && norm(templateName).startsWith(norm(customerName))) {
        console.warn(`Discarding name "${customerName}" — it is a prefix of the template title`);
        customerName = '';
      }

      const firstName = customerName ? customerName.split(' ')[0] : '';
      const lastName = customerName ? customerName.split(' ').slice(1).join(' ') : '';

      if (!env.GSHEET_WEBHOOK_URL) {
        console.error('GSHEET_WEBHOOK_URL is not set');
        return new Response(JSON.stringify({ error: 'Google Sheet webhook URL not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // --- Google Sheets always runs, email or not -------------------------
      // Logging every download keeps the reporting complete even for templates
      // that do not request an email address.
      const sheetTask = (async () => {
        try {
          console.log('Sending to Google Sheets via Apps Script...');
          const gsResponse = await fetch(env.GSHEET_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          console.log(`Google Sheets response status: ${gsResponse.status}`);

          if (!gsResponse.ok) {
            console.error(`Google Sheets error: ${gsResponse.status}`);
          } else {
            console.log('Successfully sent data to Google Sheets');
          }
        } catch (error) {
          console.error('Error calling Google Sheets webhook:', error.message);
        }
      })();

      // --- No email shared: log the row, skip Resend, return 200 -----------
      if (!buyerEmail) {
        console.warn('No customerEmail in payload — logging to Sheets and Notion only');
        ctx.waitUntil(Promise.all([
          sheetTask,
          writeNotionRow(env, {
            payload,
            buyerEmail: '',
            templateName,
            resendStatus: 'skipped',
            timestamp: eventTimestamp,
          }),
        ]));
        return new Response(JSON.stringify({
          success: true,
          skipped: 'no_email_shared',
          message: 'Logged to Google Sheets and Notion, no subscriber created'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!env.RESEND_API_KEY) {
        console.error('RESEND_API_KEY is not set');
        return new Response(JSON.stringify({ error: 'Resend API key not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`Processing: ${buyerEmail} for template ${templateName}`);

      // The Notion row records what Resend actually did, so the two tasks cannot be
      // fully parallel. Rather than re-nesting them, Resend publishes its outcome
      // through this promise and the Notion task waits on it. Everything else keeps
      // running in parallel exactly as before.
      let publishResendStatus;
      const resendStatus = new Promise((resolve) => { publishResendStatus = resolve; });

      // --- Resend + Sheets + Notion in parallel ----------------------------
      ctx.waitUntil(
        Promise.all([
          sheetTask,

          // Add the contact to Resend
          (async () => {
            let contactStatus = 'failed';
            try {
              console.log('Sending to Resend API...');

              const contactBody = {
                email: buyerEmail,
                first_name: firstName,
                last_name: lastName,
                unsubscribed: false,
                properties: {
                  template_purchased: templateName,
                  purchase_date: eventTimestamp,
                  source: 'notion-marketplace',
                },
              };

              // Drop new downloaders straight into a segment if one is configured.
              if (env.RESEND_SEGMENT_ID) {
                contactBody.segments = [{ id: env.RESEND_SEGMENT_ID }];
              }

              const rsResponse = await fetch('https://api.resend.com/contacts', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                },
                body: JSON.stringify(contactBody),
              });

              const rsData = await rsResponse.text();
              console.log(`Resend response status: ${rsResponse.status}`);

              // 409 = contact already exists. Normal on a repeat download.
              if (!rsResponse.ok && rsResponse.status !== 409) {
                console.error(`Resend error: ${rsResponse.status} - ${rsData}`);
                contactStatus = 'failed';
              } else if (rsResponse.status === 409) {
                console.log(`${buyerEmail} already a Resend contact (repeat download)`);
                contactStatus = 'duplicate';
              } else {
                console.log(`Successfully added ${buyerEmail} to Resend`);
                contactStatus = 'created';
              }
              publishResendStatus(contactStatus);

              // Belt-and-braces segment attach. `segments` in the create body above
              // covers new contacts, but a repeat downloader returns 409 and is never
              // re-segmented by that path. This explicit call catches them.
              if (env.RESEND_SEGMENT_ID) {
                let contactRef = buyerEmail;
                try {
                  const parsed = JSON.parse(rsData);
                  if (parsed && parsed.id) contactRef = parsed.id;
                } catch (err) { /* 409 body is not JSON; fall back to the email */ }

                const segResponse = await fetch(
                  `https://api.resend.com/contacts/${encodeURIComponent(contactRef)}/segments/${encodeURIComponent(env.RESEND_SEGMENT_ID)}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                    },
                  }
                );

                if (segResponse.ok || segResponse.status === 409) {
                  console.log(`${buyerEmail} is in segment ${env.RESEND_SEGMENT_ID}`);
                } else {
                  console.error(`Segment attach failed: ${segResponse.status} - ${await segResponse.text()}`);
                }
              }
            } catch (error) {
              console.error('Error calling Resend:', error.message);
            } finally {
              // Resolving twice is a no-op, so this is purely a guarantee: however
              // this block exits, the Notion task can never be left hanging.
              publishResendStatus(contactStatus);
            }
          })(),

          // Append the Notion row once the Resend outcome is known.
          (async () => {
            await writeNotionRow(env, {
              payload,
              buyerEmail,
              templateName,
              resendStatus: await resendStatus,
              timestamp: eventTimestamp,
            });
          })(),

          // Fire the Automation trigger event — only once RESEND_EVENT_NAME is set
          (async () => {
            if (!env.RESEND_EVENT_NAME) {
              console.log('RESEND_EVENT_NAME not set, skipping automation trigger');
              return;
            }
            try {
              console.log(`Firing Resend event: ${env.RESEND_EVENT_NAME}`);
              const evResponse = await fetch('https://api.resend.com/events', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                  event: env.RESEND_EVENT_NAME,
                  email: buyerEmail,
                  payload: {
                    template: templateName,
                    first_name: firstName,
                    source: 'notion-marketplace',
                  },
                }),
              });

              console.log(`Resend event status: ${evResponse.status}`);
              if (!evResponse.ok) {
                console.error(`Resend event error: ${evResponse.status} - ${await evResponse.text()}`);
              }
            } catch (error) {
              console.error('Error firing Resend event:', error.message);
            }
          })(),
        ])
      );

      return new Response(JSON.stringify({
        success: true,
        email: buyerEmail,
        message: 'Webhook received, data sent to Resend, Google Sheets and Notion'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error processing request:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
