---
title: "Brand phishing pages: how to spot them before your customers do"
slug: brand-phishing-pages
description: "Phishing pages copy your login or checkout to steal customer details. How to find them early, how to confirm one, and who to report it to."
pillar: Threats
publishDate: 2026-10-04
image: images/08-brand-phishing-pages.jpg
imageAlt: "A browser window with a blank login form, and a red fishing hook dropping into the password field."
readingTime: 7 min
---

# Brand phishing pages: how to spot them before your customers do

A counterfeit listing sells a fake product. A phishing page sells nothing: it copies
your login screen, checkout or "order tracking" page and collects whatever the
customer types in. It's the most serious kind of brand abuse because the harm is
immediate. Within minutes of a customer typing their password, the attacker can be
inside the real account.

You usually find out late, from a customer who has already been caught. This article
covers how to find these pages earlier, how to check that a page really is phishing,
and where to report it so it comes down.

## What brand phishing pages look like

Most of them fall into a few patterns:

- **Login clones.** A copy of your sign-in page, often with the HTML and images taken
  straight from your site. The form posts to the attacker's server rather than yours.
- **Fake checkout or payment pages.** Usually reached from a "sale" ad or a fake
  store. The product doesn't matter; the card form does.
- **Delivery and order notices.** "Your order is on hold, confirm your details." These
  work especially well for brands that ship physical goods, because customers expect
  delivery messages.
- **Account-problem pages.** "Unusual activity detected, verify your account." The
  urgency is there to stop people thinking.
- **Giveaway and refund pages.** Often reached from a
  [fake support account](./07-fake-customer-support-accounts.md) on social media.

Nearly all of them sit on a domain chosen to look like yours: a misspelling, an extra
word like *-login* or *-secure*, a different top-level domain, or your brand name as
a subdomain of something unrelated (`yourbrand.example-host.com`). That's why
[lookalike-domain monitoring](./03-lookalike-domains-typosquatting.md) is the best
early warning you have.

## Where to look

### Newly issued certificates

Almost every website now uses HTTPS, which means a certificate, and public
certificates are recorded in Certificate Transparency logs that anyone can search.
A search for your brand name across those logs (crt.sh is one free interface) shows
certificates issued for domains and subdomains containing it. A certificate issued
yesterday for `yourbrand-account-verify` on a domain you don't own deserves a look.

It isn't a complete source. Attackers can avoid using your name in the hostname, and
plenty of results will be harmless. But it's free, and it often surfaces a page
before it is sent to anyone.

### Lookalike domain registrations

Check domain registrations that contain your brand or close variants of it. A
registration on its own isn't phishing, since many lookalikes are parked or held for
resale, but a lookalike that suddenly starts serving a login form is.

### Search results

Search for your brand name with words like *login*, *sign in*, *account*, *verify*,
*track order* and *refund*, and look at every result that isn't on your domain. Some
search results carry the search engine's own warning that a site may be harmful,
which is strong independent evidence when you find it.

### Your own customers and staff

Make it easy to report. A short page on your site that says how to forward a
suspicious email or link, plus a support macro that asks for the URL, turns your
customers into a detection network. Ask your support team to escalate any ticket
mentioning a login or payment that the customer doesn't recognise.

## Confirming a page is phishing

Before you report anything, be sure. A false report wastes everyone's time and costs
you credibility with the abuse desks you'll need again. **Don't enter real
credentials, and don't visit suspect pages from a machine that matters.** Use an
isolated browser profile or a sandboxed environment.

Signs that a page is phishing rather than, say, a fan site or a reseller:

- It shows a login, payment or personal-details form that imitates yours.
- It uses your logo, product images or the exact wording of your site.
- It's on a domain you don't own and haven't authorised.
- The form doesn't send data to your systems. Your engineers can check where it posts.
- It was registered or set up recently. Domain registration data and certificate
  dates help here.

Write down what you saw before you report. Phishing pages are often short-lived, and
some deliberately show harmless content to visitors they think are investigators. A
timestamped screenshot, the full URL and the page source are worth having; the
[evidence file](./09-takedown-evidence-file.md) lists what to capture.

## Where to report it

Report to several places at once. Each one closes a different door, and none of them
works instantly.

| Report to | What it does |
|---|---|
| **The hosting provider's abuse contact** | Can take the page offline. Find the host from the domain's DNS records or an IP lookup. |
| **The domain registrar's abuse contact** | Can suspend the domain, which takes down everything on it. Registrars accredited by ICANN are required to keep an abuse contact. |
| **Browser blocklists** (for example, Google Safe Browsing's phishing report form) | Gets a warning shown to visitors in browsers that use the list, even before the page comes down. |
| **Anti-phishing groups** such as the APWG | Shares the URL with the security vendors and providers who use their feeds. |
| **The platform behind the link**, if it was delivered through social media, ads or email | Removes the delivery route. |

In each report, include the full URL, a screenshot, a short statement that the page
impersonates your company, and a link to your real login page for comparison. Keep
the report short and factual. Abuse desks handle a lot of reports, and a clear one
gets dealt with faster.

Check again after a day or two. If the page is still up, follow up with the same
recipient and include the original report reference.

## What to tell customers

If there's any sign customers have used the page, act on the account side as well:

- Force a password reset for accounts that may be affected, if your systems can tell
  which ones.
- Tell affected customers clearly what happened and what to do: change their
  password, check their card statements, and turn on two-factor authentication if
  you offer it.
- Repeat the one rule that helps most: *we will never ask for your password or a
  one-time code by email, text or DM.*

## Put it in a routine

Phishing pages come and go quickly, so occasional checks miss most of them. The
sources above — certificate logs, lookalike registrations, search results and your
support inbox — are cheap to check every week. Make it one routine, together with the
checks you already run for counterfeits and impersonation, because the same
lookalike domain often serves all three. This is general security guidance, not
legal advice; if customer data may have been exposed, ask your counsel whether you
have notification obligations.

---

**Check what's using your brand right now.** A [free Defenex scan](/scan) searches
for phishing pages, lookalike domains, impersonation and counterfeit listings. Every
finding includes the text quoted from the page. It takes about 90 seconds and you
don't need an account.
