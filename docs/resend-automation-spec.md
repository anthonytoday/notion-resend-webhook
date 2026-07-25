# Resend Automation Spec — Post-Download Funnel

**Replaces:** the MailerLite automation deployed June 18, 2026.
**Trigger event:** `template.downloaded` (fired by the worker).
**Free tier:** 10,000 Automation Runs/month, 3,000 emails/month. At ~250 downloads/week (~1,000/month) with 7 emails each, sending exceeds the free email tier well before the run tier. Budget for the paid plan or trim the chain.

---

## 1. Event definition

Create the event first (Resend → Events → New event), name `template.downloaded`, with this payload schema:

| Key | Type | Example |
|---|---|---|
| `template` | string | `Ultimate Content Manager` |
| `template_id` | string | `tpl_8231` |
| `category` | string | `business` |
| `first_name` | string | `Luis` |
| `source` | string | `notion-marketplace` |

The worker already sends exactly these keys.

---

## 2. Automation steps

Build in Resend → Automations → New. Steps and connections in order:

| Step key | Type | Config |
|---|---|---|
| `start` | trigger | event `template.downloaded` |
| `e1` | send_email | Template: **E1 Welcome + Free Upgrade** |
| `wait_2` | delay | 2 days |
| `e2` | send_email | Template: **E2 Real Results (12 hrs saved)** |
| `wait_3` | delay | 3 days (Day 5) |
| `e3` | send_email | Template: **E3 Bundle Cross-Sell** |
| `wait_4` | delay | 3 days (Day 8) |
| `e4` | send_email | Template: **E4 Retention + Tips (affiliate P.S.)** |
| `wait_5` | delay | 4 days (Day 12) |
| `e5` | send_email | Template: **E5 Credibility** |
| `wait_6` | delay | 3 days (Day 15) |
| `e6` | send_email | Template: **E6 Ecosystem / Repeat** |
| `wait_7` | delay | 6 days (Day 21) |
| `e7` | send_email | Template: **E7 Audit Close** |

Delays are **cumulative gaps**, not absolute days. The Day column from the MailerLite build maps to: 0, 2, 5, 8, 12, 15, 21.

---

## 3. Offer placement (do not change without a reason)

| Email | Offer type | Notes |
|---|---|---|
| E1 | **Affiliate (hero)** | Notion Business free up to 3 months. `(affiliate link)` disclosure required. |
| E2 | Consulting warm-up | No offer competition. |
| E3 | **Paid** — bundle | No affiliate link. |
| E4 | Consulting + **one** affiliate P.S. | The only reminder. |
| E5 | Consulting warm-up | — |
| E6 | **Paid** — templates | No affiliate link. |
| E7 | **Paid** — $200 Ops Audit | No affiliate link. |

Rule carried over from the July 23 analysis: a free Notion trial competes with a paid bundle for the same click, so it stays out of E3, E6, and E7.

---

## 4. Personalization tokens

Resend Templates use the event payload. Replace MailerLite's `{$name}` with:

- `{{ first_name }}` → falls back to empty; keep greetings name-optional ("Hey,") as in the current copy.
- `{{ template }}` → useful in E1 ("You picked up **{{ template }}**").

---

## 5. Branching worth adding later (not day one)

- **Condition on `category`**: business/cert downloaders get the audit close (E7); personal-template downloaders get a lighter final email. Cheap way to protect sender reputation once capture opens to all templates.
- **Wait-for-event `session.booked`**: exit the chain when someone books, so a paying client stops receiving sales emails.

---

## 6. Affiliate link and disclosure

Canonical link: `https://affiliate.notion.so/0x8u16p4sff1`
Required on every use: the words `(affiliate link)` adjacent to the CTA. Program rules also ban self-referrals, incentivized signups, and paid ads on Notion-branded keywords.

---

## 7. Cutover checklist (MailerLite → Resend)

1. Verify `anthonytoday.com` as a sending domain in Resend (SPF, DKIM, DMARC records).
2. Export MailerLite subscribers → import into the Resend audience. **Do not** enroll imports in the automation (they already received the chain).
3. Build the 7 Templates, then the Automation, keep status `disabled`.
4. Fire a test event to your own address, watch the run panel step through.
5. Publish the Automation.
6. Deploy the worker pointing at Resend.
7. Send one real test download end-to-end: check Resend contact, run started, and Sheets row.
8. **Pause the MailerLite automation** (do not delete for 30 days, in case of rollback).
9. After 30 days clean, downgrade or cancel MailerLite.
