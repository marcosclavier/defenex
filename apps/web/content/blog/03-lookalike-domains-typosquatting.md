---
title: "Lookalike domains: how typosquatting works and what to do when you find one"
slug: lookalike-domains-typosquatting
description: "The patterns behind domains built to be mistaken for yours, how to tell a parked name from a live threat, and which response fits each case."
pillar: Threats
publishDate: 2026-10-04
image: images/03-lookalike-domains-typosquatting.jpg
imageAlt: "Two nearly identical doors side by side; the one on the right is a flat facade propped up by struts, its frame glowing red."
readingTime: 7 min
---

A lookalike domain is a domain registered to be mistaken for yours. It might be
one letter off, or your brand with "-outlet" on the end, or your exact name on a
different extension. Some sit parked for years and never do anything. Some are
running a counterfeit store or a phishing page the day after they're registered.

The work is telling those apart, and responding in proportion.

## The patterns

Lookalikes are not random. Nearly all of them follow a handful of patterns, which
is useful, because it means you can generate the list yourself.

| Pattern | Example for `acmetools.com` | Why it works |
|---|---|---|
| Omission | `acmetols.com` | A single missed keystroke |
| Transposition | `acmetoosl.com` | Swapped adjacent letters |
| Substitution | `acnetools.com` | Neighbouring key on the keyboard |
| Doubling | `acmettools.com` | Repeated letter, easy to miss |
| Visual lookalike | `acrnetools.com` | `rn` reads as `m` at a glance |
| Homoglyph (IDN) | `аcmetools.com` with a Cyrillic `а` | Identical on screen, different domain |
| Hyphenation | `acme-tools.com` | Looks like a legitimate variant |
| Combo | `acmetools-outlet.com`, `acmetools-support.com` | Adds a plausible word |
| Different extension | `acmetools.co`, `acmetools.shop` | Same name, other TLD |
| Subdomain trick | `acmetools.com.example-login.net` | The real brand sits at the left of a different domain |

The combo pattern is the one to watch most closely. Typo domains catch people who
mistype; combo domains are what gets *sent* to people — in ads, emails and social
posts — because `brand-outlet` or `brand-support` reads as official.

## Finding them

Three sources, from easiest to most thorough:

1. **Generate and check the obvious variants.** Take the patterns above, produce
   variants of your main domain, and see which resolve. Open-source tools such as
   dnstwist automate the generation and the DNS lookups.
2. **Search for combo names.** Search engines will find live sites using your brand
   plus *outlet*, *sale*, *store*, *official* or a country name, which the variant
   generators won't predict.
3. **Watch certificate transparency logs.** Almost every website now gets a TLS
   certificate, and certificates are published in public logs. Searching those
   logs (for example through crt.sh) for your brand name turns up new domains,
   often before they're in any search engine.

## Is it a threat? Four checks

Most lookalikes you find will be parked or empty. Before you spend money on any of
them, look at what each one actually does.

- **Does it resolve, and to what?** A registrar parking page with ads is
  different from a store selling your product.
- **Does it have mail records?** A domain with MX records configured can send and
  receive email. A lookalike that can send email is a phishing risk even if it has
  no website.
- **When was it registered?** A domain registered last week that already has a
  certificate and a live site is far more likely to be active abuse than one
  that has been parked since 2014. Registration data is visible through WHOIS or
  RDAP, though owner details are usually redacted.
- **What's on the page?** Quote it. Your logo, your product photos, a login form,
  a checkout — each points to a different response.

Write down what you find. If you escalate later, the history matters.

## Matching the response to the domain

| What you found | Sensible response |
|---|---|
| Parked, no content, no mail | Record it and monitor. Act if it changes. |
| Parked, offered for sale | Usually still monitor. Buying it can be reasonable if it's cheap and genuinely confusing, but it rewards the practice. |
| Selling counterfeits of your product | Report to the hosting provider and registrar, report the page to search engines, and report any marketplace or payment links. |
| Phishing for your customers' logins or payment details | Act the same day: registrar and host abuse contacts, browser safe-browsing reports, and a warning to customers. See [brand phishing pages](./08-brand-phishing-pages.md). |
| Used for a fake support or social presence | Report the accounts on each platform as well as the domain. See [fake support accounts](./07-fake-customer-support-accounts.md). |
| Clearly confusing and you want it back permanently | A UDRP complaint. See [UDRP explained](./05-udrp-explained.md). |

### Abuse reports to the registrar and host

Every registrar and hosting provider publishes an abuse contact, usually listed in
WHOIS/RDAP results and on their website. A short, specific report — the domain,
what's on it, a screenshot, your rights, and what you're asking for — gets
better results than a long one. Phishing and malware reports are usually handled
fastest; registrars treat them as security issues. Counterfeit-store reports
depend more on the provider's policy, and some providers ignore them.

### UDRP and URS

If the domain itself is the problem — not just the content currently on it — the
Uniform Domain-Name Dispute-Resolution Policy (UDRP) is the standard way to have it
transferred to you. It's a paper process, not a lawsuit, and has a fixed fee.
Many newer extensions also support the Uniform Rapid Suspension System (URS),
which is cheaper and faster but only suspends the domain rather than transferring
it, and requires a clearer case. Check which applies to the extension in
question. We cover UDRP in detail in [UDRP explained](./05-udrp-explained.md).

*None of this is legal advice; for anything beyond an abuse report, talk to a
trademark lawyer.*

## What not to do

- **Don't contact the registrant to negotiate** before you've captured the site.
  It tells them to move, and an offer to buy can later be used to argue the
  domain was a business opportunity rather than abuse.
- **Don't send a legal threat to a parked domain owner** on day one. If the domain
  never goes live, you've spent effort and possibly started a dispute over
  nothing.
- **Don't assume the WHOIS contact is the operator.** Privacy services and
  resellers sit in the way. Write to the registrar's abuse address, not the
  redacted registrant.

## Prevention, within reason

You can't register every variant of your name, and you shouldn't try. A
reasonable baseline:

- Register your name on the extensions that matter for your markets, and the one
  or two most obvious typos of your main domain.
- Set up email authentication (SPF, DKIM and DMARC) on your own domain. It
  doesn't stop lookalikes, but it stops attackers sending mail that appears to
  come from your real address, which pushes them towards lookalikes you can see.
- Monitor rather than buy. New lookalikes are registered all the time; a weekly
  check of new registrations and certificates catches the ones that go live.

## See which lookalikes are live

Defenex checks for lookalike domains as part of every scan, fetches what's on
them, and reports only the ones doing something — with a quote from the page to
show what. [Scan your brand](/scan): free, no account, about 90 seconds.
