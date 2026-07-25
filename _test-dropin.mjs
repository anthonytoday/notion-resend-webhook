import worker from './worker-dropin.js';
const calls=[]; globalThis.fetch=async(u,o)=>{calls.push({url:String(u),body:o?.body});return new Response('{"id":"x"}',{status:200})};
const waits=[]; const ctx={waitUntil:p=>waits.push(p)};
const env={RESEND_API_KEY:'re_x',GSHEET_WEBHOOK_URL:'https://script.google.com/exec'};
const post=(b,e={})=>worker.fetch(new Request('https://w.dev/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),{...env,...e},ctx);
let fail=0; const A=(l,c)=>{if(!c)fail++;console.log(`${c?'PASS':'FAIL'}  ${l}`)};

calls.length=0;waits.length=0;
let r=await post({customerEmail:'luis@startup.io',templateName:'Notion + AI Hub',customerName:'Luis Molouny'});
let j=await r.json(); await Promise.all(waits);
A('real payload -> 200',r.status===200&&j.email==='luis@startup.io');
A('flat /contacts endpoint',calls.some(c=>c.url==='https://api.resend.com/contacts'));
A('no segments key when unset',!JSON.parse(calls.find(c=>c.url.includes('contacts')).body).segments);

calls.length=0;waits.length=0;
await post({customerEmail:'a@b.com',templateName:'T'},{RESEND_SEGMENT_ID:'3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe'});
await Promise.all(waits);
const cb=JSON.parse(calls.find(c=>c.url.includes('contacts')).body);
A('segment attached when set',cb.segments?.[0]?.id==='3bd09f4b-0b72-4ed3-b5d2-f4c40dd99bfe');
console.log('   contact body:',JSON.stringify(cb));

calls.length=0;waits.length=0;
r=await post({templateName:'Ungated'}); j=await r.json(); await Promise.all(waits);
A('no email -> 200 + sheet only',r.status===200&&j.skipped==='no_email_shared'&&!calls.some(c=>c.url.includes('resend')));
console.log(`\n${fail===0?'ALL TESTS PASSED':fail+' FAILURE(S)'}`);
