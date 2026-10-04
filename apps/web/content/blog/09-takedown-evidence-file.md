---
title: "The evidence file: what to capture before you send any takedown"
slug: takedown-evidence-file
description: "Infringing pages disappear and come back. What to record before filing a takedown so you can prove it, escalate it, and show a pattern later."
pillar: Enforce
publishDate: 2026-10-04
image: images/09-takedown-evidence-file.jpg
imageAlt: "An open case folder holding a screenshot, a clock, a fingerprint pattern and a sealed envelope."
readingTime: 8 min
---

# The evidence file: what to capture before you send any takedown

The most common mistake in brand enforcement happens before the notice is sent:
filing it without first recording what you're complaining about.

It seems like a small thing. The listing is right there; anyone can click the link.
But infringing pages don't stay put. The seller edits the title once the complaint
arrives. The listing is removed, then relisted under another account. A phishing page
shows harmless content to anyone who looks like an investigator. If the platform asks
for more detail, or you need to escalate, or you want to show that this seller has
done it four times, a link that now returns a 404 proves nothing.

An evidence file fixes that. It's a record of each finding as it was when you found
it, which you can rely on later. This article covers what goes in it and how to keep
it in order.

*This is a practical guide, not legal advice. If a matter may go to litigation, ask
counsel how evidence should be collected and preserved for your jurisdiction.*

## What to capture for every finding

### 1. The full URL, exactly

Copy the URL from the address bar, not from a search result, because search results
often go through redirects. Keep any listing ID or item number separately as well;
marketplaces identify listings by ID, and the URL format can change.

### 2. A full-page screenshot

Capture the whole page, not just the visible screen: title, images, price, seller
name, description and any "ships from" details. Most browsers can take a full-page
screenshot natively or with an extension. Make sure your system clock is correct and
that the date and time are recorded, either visible in the capture or in the file
metadata you store with it.

### 3. The page itself

A screenshot shows what you saw. A saved copy of the page (HTML, or a web archive
file) shows what the page contained, including text you might not have noticed. Save
both.

### 4. A third-party archive copy

Your own screenshot is your word. A copy held by an independent archive is harder to
dispute. Public web archives such as the Internet Archive's Wayback Machine let you
request a snapshot of a page. It won't work for every page: some sites block
archiving, and pages behind a login can't be captured. When it does work, it gives
you a timestamped record that you didn't make yourself.

### 5. The seller or operator

Record who's behind the page, as far as you can tell:

- **Marketplaces:** seller name, seller ID, storefront URL, and any business name or
  address the platform shows.
- **Standalone sites:** domain registration data (WHOIS/RDAP — often redacted, but
  the registrar and creation date are usually visible), hosting provider (from DNS or
  an IP lookup), and any contact details on the site.
- **Social accounts:** handle, display name, profile URL, and the account's numeric
  ID if the platform exposes one, since handles can change and IDs usually don't.

### 6. What makes it infringing

This is the part most often missing. Write one or two sentences saying what the page
does and quoting the specific text or describing the specific image that shows it.

> "Listing title reads 'Replica [Brand] Cooler Wholesale'. Main image is our
> product photo from our product page (link), unchanged."

Use the page's own words. "This is a counterfeit" is an assertion. A quote from the
page saying "replica" or "1:1 copy", next to your trademark, is evidence. Stay
factual: describe what the page shows rather than concluding that it's illegal.

### 7. Your rights

Record which right the finding infringes and attach the proof, once, in a place every
finding can point to:

- Trademark registration numbers and jurisdictions.
- For copied images or text, the original files and where and when you first
  published them.
- If you're acting for the rights owner, the written authorisation.

Which right you rely on decides which notice you file. See
[DMCA or trademark complaint?](./04-dmca-or-trademark-complaint.md).

### 8. Test purchases, if you make them

For high-stakes cases, a test purchase can establish that goods are fake in a way a
listing can't. If you make one, record the order confirmation, payment record,
shipping label, and photos of the package and product as received. Ask counsel first
if the case may go to court, because how a test purchase is made and documented can
matter.

## Make the file trustworthy

Evidence is only useful if someone else can trust it later. A few habits help a lot:

- **Don't edit originals.** Store the original capture. If you need an annotated
  version (arrows, highlights), save it as a separate file.
- **Hash the files.** Computing a checksum (for example, SHA-256) of each capture
  when you save it lets you show later that the file hasn't changed. Store the hash
  in your log.
- **Use one naming convention.** Something like
  `2026-11-09_amazon_B0XXXXXXX_screenshot.png` makes files sortable and findable.
- **Write once and keep it.** Store captures somewhere they won't be overwritten or
  quietly deleted: a dedicated folder with restricted edit rights, or storage with
  versioning turned on.

## The log that ties it together

Each finding gets one row in a log. The captures are the evidence; the log is what
lets you use it.

| Field | Why it matters |
|---|---|
| Finding ID | Your own stable reference across relistings |
| URL / listing ID | What you're reporting |
| Platform / host | Which enforcement channel applies |
| Seller / operator ID | Links repeat infringers together |
| Category | Counterfeit, lookalike domain, phishing, impersonation… |
| First seen / last seen | Shows how long it has been up, and whether it came back |
| Evidence files + hashes | Points to the captures |
| Right relied on | Trademark reg. no. or copyrighted work |
| Notice filed: date, channel, report ID | Your record of action |
| Outcome and date confirmed | Removed, rejected, no response, relisted |

The *seller ID* and *first seen / last seen* columns turn a pile of single complaints
into a repeat-infringer case. When the same seller ID appears in five rows, the next
notice can say so and cite the earlier report IDs. That's the argument that gets an
account closed rather than one listing removed. Relisting is the normal pattern (see
[why counterfeiters relist](./06-why-counterfeiters-relist.md)), so the log will
probably be the most useful thing you build.

## Check removals instead of assuming them

When a platform says a listing was removed, open the URL yourself and record the
result. Sometimes "removed" means hidden in one country, or the listing has already
been replaced by an identical copy. Record the date you confirmed the removal. That
date is how you know the notice worked, and it's what you'll compare against if the
listing comes back.

## How long it takes

Done by hand, a full capture for one finding takes a few minutes once you have a
routine, and longer the first few times. That's manageable for a handful of findings
a week. With dozens, the capture work starts crowding out the decision work: whether
a finding is real and which channel it belongs in. That's usually when people start
automating capture, or hand the work to a service that keeps an evidence record as
part of every finding.

For the next step, filing the notice, see
[reporting counterfeits on Amazon, eBay, Etsy and AliExpress](./02-report-counterfeits-by-platform.md).

---

**Start with findings that already have evidence.** A [free Defenex scan](/scan)
searches the open web for counterfeits, lookalike domains, phishing and
impersonation of your brand, and quotes the text from each page that supports the
finding. No account; about 90 seconds.
