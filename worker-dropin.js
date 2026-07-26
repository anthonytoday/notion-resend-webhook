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
 *
 * Remove MAILERLITE_API_KEY and MAILERLITE_GROUP_ID only after verifying this works.
 */

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
      const customerName = payload.customerName || payload.name || '';
      const firstName = customerName.split(' ')[0] || '';
      const lastName = customerName.split(' ').slice(1).join(' ') || '';

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
        console.warn('No customerEmail in payload — logging to Sheets only');
        ctx.waitUntil(sheetTask);
        return new Response(JSON.stringify({
          success: true,
          skipped: 'no_email_shared',
          message: 'Logged to Google Sheets, no subscriber created'
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

      // --- Resend + Sheets in parallel -------------------------------------
      ctx.waitUntil(
        Promise.all([
          sheetTask,

          // Add the contact to Resend
          (async () => {
            try {
              console.log('Sending to Resend API...');

              const contactBody = {
                email: buyerEmail,
                first_name: firstName,
                last_name: lastName,
                unsubscribed: false,
                properties: {
                  template_purchased: templateName,
                  purchase_date: new Date().toISOString(),
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
                return;
              } else if (rsResponse.status === 409) {
                console.log(`${buyerEmail} already a Resend contact (repeat download)`);
              } else {
                console.log(`Successfully added ${buyerEmail} to Resend`);
              }

              // Segment attachment, explicitly.
              //
              // The inline `segments` array above is best-effort: Resend documents
              // segment membership as its own endpoint
              // (POST /contacts/{id}/segments/{segment_id}), and an unsupported field
              // on the create call is silently dropped rather than rejected. Without
              // this second call a repeat downloader (409, no create side effects) or
              // an ignored inline field would leave the contact outside the segment
              // and therefore outside every broadcast. Cheap call, removes the doubt.
              if (env.RESEND_SEGMENT_ID) {
                let contactRef = buyerEmail; // contacts are addressable by email
                try {
                  const parsed = JSON.parse(rsData);
                  if (parsed && parsed.id) contactRef = parsed.id;
                } catch (err) { /* 409 bodies are not always JSON */ }

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
                  console.error(
                    `Segment attach failed: ${segResponse.status} - ${await segResponse.text()}`
                  );
                }
              }
            } catch (error) {
              console.error('Error calling Resend:', error.message);
            }
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
        message: 'Webhook received, data sent to Resend and Google Sheets'
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
