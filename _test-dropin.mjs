/**
 * Local test harness — no network, no Cloudflare account needed.
 *
 *   npm test
 *
 * Covers the Resend + Sheets behaviour from the original harness, plus the Notion
 * row added July 29, 2026: field mapping, the three Notion input constraints
 * (comma in a select name, 100-char select cap, 2000-char rich_text cap), the
 * ungated no-email path, graceful skip when unconfigured, and the guarantee that a
 * Notion failure never takes down Resend or Sheets.
 */

import worker from './worker-dropin.js';

const NOTION_URL = 'https://api.notion.com/v1/pages';
const CONTACTS_URL = 'https://api.resend.com/contacts';

let calls = [];
let responder = () => new Response('{"id":"x"}', { status: 200 });
globalThis.fetch = async (u, o) => {
  calls.push({ url: String(u), body: o?.body });
  return responder(String(u), o);
};

const env = {
  RESEND_API_KEY: 're_x',
  GSHEET_WEBHOOK_URL: 'https://script.google.com/exec',
  NOTION_TOKEN: 'ntn_test',
  NOTION_DB_ID: '23aa8b75-c880-4a26-b0b2-749a5d66f1e3',
};

let waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };

async function post(body, envOverrides = {}, respond) {
  calls = [];
  waits = [];
  responder = respond || (() => new Response('{"id":"x"}', { status: 200 }));
  const res = await worker.fetch(
    new Request('https://w.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { ...env, ...envOverrides },
    ctx
  );
  const json = await res.json();
  await Promise.all(waits);
  return { res, json };
}

let fail = 0;
const A = (label, cond) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};
const notionCall = () => calls.find((c) => c.url === NOTION_URL);
const notionProps = () => JSON.parse(notionCall().body).properties;

console.log('\n--- original behaviour, unchanged --------------------------------');

let r = await post({
  customerEmail: 'luis@startup.io',
  templateName: 'Notion + AI Hub',
  customerName: 'Luis Molouny',
});
A('real payload -> 200', r.res.status === 200 && r.json.email === 'luis@startup.io');
A('flat /contacts endpoint', calls.some((c) => c.url === CONTACTS_URL));
A('no segments key when unset', !JSON.parse(calls.find((c) => c.url === CONTACTS_URL).body).segments);

r = await post({ customerEmail: 'a@b.com', templateName: 'T' }, {
  RESEND_SEGMENT_ID: '3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe',
});
const cb = JSON.parse(calls.find((c) => c.url.includes('contacts')).body);
A('segment attached when set', cb.segments?.[0]?.id === '3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe');

console.log('\n--- notion row --------------------------------------------------');

r = await post({
  customerEmail: 'luis@startup.io',
  templateName: 'Notion + AI Hub',
  name: 'Notion + AI Hub',
});
let p = notionProps();
A('notion called exactly once', calls.filter((c) => c.url === NOTION_URL).length === 1);
A('parent is the configured database', JSON.parse(notionCall().body).parent.database_id === env.NOTION_DB_ID);
A('title is the email', p.Downloader.title[0].text.content === 'luis@startup.io');
A('email property set', p.Email.email === 'luis@startup.io');
A('template mapped', p.Template.select.name === 'Notion + AI Hub');
A('email shared true', p['Email Shared'].checkbox === true);
A('source tagged', p.Source.select.name === 'notion-marketplace');
A('resend status created', p['Resend Status'].select.name === 'created');
A('raw payload preserved', JSON.parse(p['Raw Payload'].rich_text[0].text.content).name === 'Notion + AI Hub');
A('downloaded-at is ISO', !Number.isNaN(Date.parse(p['Downloaded At'].date.start)));
A(
  'notion timestamp matches resend purchase_date',
  JSON.parse(calls.find((c) => c.url === CONTACTS_URL).body).properties.purchase_date ===
    p['Downloaded At'].date.start
);

console.log('\n--- notion input constraints ------------------------------------');

const longName = 'A'.repeat(140) + ', with a comma';
r = await post({ customerEmail: 'x@y.com', templateName: longName });
p = notionProps();
A('comma stripped from select name', !p.Template.select.name.includes(','));
A('select name capped at 100', p.Template.select.name.length <= 100);

r = await post({ customerEmail: 'x@y.com', templateName: 'T', junk: 'Z'.repeat(5000) });
A('raw payload capped at 2000', notionProps()['Raw Payload'].rich_text[0].text.content.length <= 2000);

r = await post({ customerEmail: 'x@y.com', templateName: '' });
A('empty template falls back to "unknown"', notionProps().Template.select.name === 'unknown');

console.log('\n--- resend outcome recorded on the row --------------------------');

r = await post({ customerEmail: 'dupe@b.com', templateName: 'T' }, {}, (url) =>
  url === CONTACTS_URL ? new Response('conflict', { status: 409 }) : new Response('{"id":"x"}', { status: 200 })
);
A('409 recorded as duplicate', notionProps()['Resend Status'].select.name === 'duplicate');

r = await post({ customerEmail: 'bad@b.com', templateName: 'T' }, {}, (url) =>
  url === CONTACTS_URL ? new Response('{"message":"bad property"}', { status: 422 }) : new Response('{"id":"x"}', { status: 200 })
);
A('422 recorded as failed (the silent-bug case)', notionProps()['Resend Status'].select.name === 'failed');

r = await post({ customerEmail: 'boom@b.com', templateName: 'T' }, {}, (url) => {
  if (url === CONTACTS_URL) throw new Error('network down');
  return new Response('{"id":"x"}', { status: 200 });
});
A('resend throwing still writes a notion row', Boolean(notionCall()));
A('thrown resend recorded as failed', notionProps()['Resend Status'].select.name === 'failed');

console.log('\n--- ungated download, no email ----------------------------------');

r = await post({ templateName: 'Ungated Planner' });
p = notionProps();
A('no email -> 200 skipped', r.res.status === 200 && r.json.skipped === 'no_email_shared');
A('no email -> resend never called', !calls.some((c) => c.url.includes('resend')));
A('no email -> notion row still written', Boolean(notionCall()));
A('no email -> placeholder title', p.Downloader.title[0].text.content === '(no email shared)');
A('no email -> Email property omitted', p.Email === undefined);
A('no email -> email shared false', p['Email Shared'].checkbox === false);
A('no email -> resend status skipped', p['Resend Status'].select.name === 'skipped');

console.log('\n--- failure isolation -------------------------------------------');

r = await post({ customerEmail: 'a@b.com', templateName: 'T' }, { NOTION_TOKEN: '' });
A('no token -> notion skipped silently', !notionCall());
A('no token -> still 200', r.res.status === 200);
A('no token -> resend + sheets still ran', calls.some((c) => c.url === CONTACTS_URL));

r = await post({ customerEmail: 'a@b.com', templateName: 'T' }, { NOTION_DB_ID: '' });
A('no db id -> notion skipped silently', !notionCall());

r = await post({ customerEmail: 'a@b.com', templateName: 'T' }, {}, (url) =>
  url === NOTION_URL
    ? new Response('{"object":"error","status":404}', { status: 404 })
    : new Response('{"id":"x"}', { status: 200 })
);
A('notion 404 -> worker still 200', r.res.status === 200 && r.json.success === true);
A('notion 404 -> sheets + resend unaffected', calls.some((c) => c.url === CONTACTS_URL) && calls.some((c) => c.url.includes('script.google.com')));

r = await post({ customerEmail: 'a@b.com', templateName: 'T' }, {}, (url) => {
  if (url === NOTION_URL) throw new Error('notion unreachable');
  return new Response('{"id":"x"}', { status: 200 });
});
A('notion throwing -> worker still 200', r.res.status === 200 && r.json.success === true);

console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
