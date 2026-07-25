/**
 * BASELINE SNAPSHOT — pulled from Cloudflare 2026-07-25 via the Cloudflare MCP connector.
 * Worker: notion-mailerlite-webhook  (id 4e912f7c840c4ee18bca570a30e967f3)
 * Last modified in Cloudflare: 2026-06-14
 *
 * DO NOT EDIT. This is the rollback copy of what was live before the Resend swap.
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
        message: 'Webhook receiver is working'
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

      // Get email from webhook
      const buyerEmail = payload.customerEmail;
      const templateName = payload.templateName || 'unknown';

      if (!buyerEmail) {
        console.warn('No customerEmail in payload');
        return new Response(JSON.stringify({ error: 'No email in payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Verify all required env vars
      if (!env.MAILERLITE_API_KEY) {
        console.error('MAILERLITE_API_KEY is not set');
        return new Response(JSON.stringify({ error: 'MailerLite API key not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!env.MAILERLITE_GROUP_ID) {
        console.error('MAILERLITE_GROUP_ID is not set');
        return new Response(JSON.stringify({ error: 'MailerLite Group ID not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!env.GSHEET_WEBHOOK_URL) {
        console.error('GSHEET_WEBHOOK_URL is not set');
        return new Response(JSON.stringify({ error: 'Google Sheet webhook URL not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`Processing: ${buyerEmail} for template ${templateName}`);

      // Send to MailerLite AND Google Sheets in parallel
      ctx.waitUntil(
        Promise.all([
          // Send to MailerLite
          (async () => {
            try {
              console.log('Sending to MailerLite API...');
              const mlResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${env.MAILERLITE_API_KEY}`,
                },
                body: JSON.stringify({
                  email: buyerEmail,
                  groups: [env.MAILERLITE_GROUP_ID],
                  fields: {
                    template_purchased: templateName,
                    purchase_date: new Date().toISOString(),
                  },
                }),
              });

              const mlData = await mlResponse.text();
              console.log(`MailerLite response status: ${mlResponse.status}`);

              if (!mlResponse.ok) {
                console.error(`MailerLite error: ${mlResponse.status} - ${mlData}`);
              } else {
                console.log(`Successfully added ${buyerEmail} to MailerLite`);
              }
            } catch (error) {
              console.error('Error calling MailerLite:', error.message);
            }
          })(),

          // Send to Google Sheets via Apps Script
          (async () => {
            try {
              console.log('Sending to Google Sheets via Apps Script...');
              const gsResponse = await fetch(env.GSHEET_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
              });

              console.log(`Google Sheets response status: ${gsResponse.status}`);

              if (!gsResponse.ok) {
                console.error(`Google Sheets error: ${gsResponse.status}`);
              } else {
                console.log(`Successfully sent data to Google Sheets`);
              }
            } catch (error) {
              console.error('Error calling Google Sheets webhook:', error.message);
            }
          })(),
        ])
      );

      return new Response(JSON.stringify({
        success: true,
        email: buyerEmail,
        message: 'Webhook received, data sent to MailerLite and Google Sheets'
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
