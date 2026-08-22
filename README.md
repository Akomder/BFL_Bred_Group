# BFL BRED Group — Digital Cash Deposit / Withdrawal Form

A tablet-first web app that replaces the hand-written cash deposit and cash withdrawal slips used at
the counter. The customer fills in the form, has their photo taken, signs on screen, checks a review
sheet, and submits. The app renders a PDF that mirrors the paper form, emails it to
`it.support@bfl.la`, and archives a copy to Google Drive. The customer can optionally receive their own
copy by email. After submitting they are told to wait for the teller to call them.

```
web/      the tablet app  — React + TypeScript + Vite + Tailwind
server/   submission service — Express, email + Google Drive/Sheets adapters
```

## Running it

Both halves need real configuration — there is no demo mode. The service refuses to start
without working mail and Google Drive credentials (see [Configuring for
production](#configuring-for-production)); the app refuses to submit without a service to
submit to.

The two halves are npm workspaces of one root package, so dependencies are installed once
from the repository root and the root lockfile is the only one.

```bash
# once, from the repository root — installs both workspaces
npm install

# 1. the submission service — needs server/.env filled in first, see below
npm start --workspace server                # http://localhost:8787

# 2. the app — needs web/.env.local (or .env.production) pointing at it, see below
npm run dev --workspace web                 # http://localhost:5173
```

Copy `web/.env.example` to `web/.env.local`:

```
VITE_API_BASE=http://localhost:8787
VITE_API_KEY=<one of the server's API_KEYS>
```

Vite inlines both at build time, so they must be set before `npm run dev` or `npm run build` — not
something that can be left for later.

The service rejects an unauthenticated form, so `VITE_API_KEY` has to match one of the values in
the server's `API_KEYS`. Generate keys with `openssl rand -hex 32`. Note that the key ends up
inside the built bundle — it keeps anonymous callers off the API, but it is a deployment
credential, not a per-user secret. See [Security](#security).

> The camera needs a secure context. `localhost` counts; on a real tablet, serve the app over HTTPS
> or the photo step will report that the camera is unavailable (the flow continues without a photo).

```bash
npm test                            # the server suite (see the note below)
npm run build --workspace web       # production build, into web/dist
```

> `web/` currently has **no test files** — the suite README once described here was deleted and
> `deploy.md` §1-S10 tracks restoring it. `npm test` at the root runs the server suite only,
> rather than failing on a suite that does not exist. Do not read a green `npm test` as the web
> side being covered.

## The flow

1. **Start** — Cash Deposit or Cash Withdrawal, plus an EN / ລາວ language toggle.
2. **Details** — the form fields, ending with the electronic-signature confirmation checkbox.
3. **Photo** — live capture from the device camera, with retake.
4. **Signature** — on-screen signature pad (stylus or finger).
5. **Review** — the eight rows below; **Edit** on any of them returns to that step and comes
   straight back to review when saved.
6. **Submit** — asks whether the customer wants a copy of the advice by email, then sends.
7. **Done** — the customer's name, the reference number, and "wait for the teller to call you".

### Fields

| Field | Behaviour |
|---|---|
| Account name | Free text, no hint |
| Account number | Five blocks — 3-7-2-4-2, 18 digits — with auto-advance and no hint |
| Account currency | LAK (default), USD, THB, EUR |
| Amount | Live thousand separators, on the same row as its own currency |
| Amount currency | Follows the account currency until it is changed on its own |
| Source of funds / Purpose of withdrawal | 500 characters, with a live counter |
| Phone number of the person processing | Free text, no hint |

Captured automatically: submission date and time, branch, Device ID and client IP.

### Review rows

Account name · account number — amount · currency — amount in words — source of funds — processed by
phone number — submission date/time · branch — Device ID · IP — photo · signature.

## Device registration

Each tablet is registered to one branch through **Device settings** on the start screen. The branch
and a generated Device ID are stored on the device and printed on every form. Edit `BRANCHES` in
`web/src/lib/device.ts` to match the real branch list.

## Configuring for production

1. **Logo** — replace `web/public/logo-bfl.png` with the real asset. The app tries
   `https://bfl-bred.com/wp-content/uploads/2022/05/BFL-BRED-Group-Logo.png` first and falls back to
   the bundled file, so a branch tablet on a restricted network still prints a logo.
2. **API keys** — set `API_KEYS` (tablets) and `ADMIN_API_KEYS` (support/IT) in `server/.env`,
   and put a device key in the app's `VITE_API_KEY`. Both are **required**; the service refuses
   to boot without them and every endpoint returns 503 rather than serving an unauthenticated
   caller. Generate each with `openssl rand -hex 32`, and keep the two lists disjoint — the boot
   check rejects a device key that would also grant spool access. See [Security](#security).
3. **Email and Google Drive** — copy `server/.env.example` to `server/.env` and fill it in. See
   [Setting up Google access](#setting-up-google-access) and [Email delivery](#email-delivery)
   below. **Both are required**: the service checks at boot and refuses to start until real,
   working credentials for a mail transport and for Drive are in place — see [Startup
   checks](#startup-checks).
4. **Branches** — see above.
5. **Lao wording** — the Lao strings in `web/src/i18n/dictionary.ts` and the Lao number words in
   `web/src/lib/amountInWords.ts` should be reviewed by a native speaker before go-live. The English
   wording is authoritative in the meantime; both are printed on the PDF.
6. **Transaction ledger (optional)** — see [Transaction ledger](#transaction-ledger-google-sheets)
   below if you want every submission logged as a row in a Google Sheet.

## Email delivery

Two messages go out per submission, and they are deliberately different:

- **The audit record** to `it.support@bfl.la` — every field, plus the branch, Device ID, IP and
  the electronic-consent line.
- **The customer's advice**, only when they asked for a copy — their transaction and the PDF,
  with **no Device ID, no IP address and no consent audit line**. `messages.test.js` fails if
  any of those leak into it.

`npm start` reads `server/.env` if it is present (via Node's `--env-file-if-exists`), so no
process manager or `dotenv` dependency is needed.

Mail goes out over plain SMTP — no Microsoft dependency here. `MAIL_FROM` should match
`SMTP_USER`; most providers (Gmail always) reject a send where the envelope sender doesn't
match the authenticated account.

## Setting up Google access

The archive authenticates as a real Google account via OAuth — **not** a service account.
Service accounts have no Drive storage of their own outside a paid Workspace Shared Drive, so
they can't upload anything to an ordinary personal Drive; this ran into that dead end before
landing here. One authorization backs both **Drive** (the PDF archive, required) and **Sheets**
(the optional ledger below).

1. In [Google Cloud Console](https://console.cloud.google.com), create or reuse a project, then
   **APIs & Services → Library** → enable the **Google Drive API** (and the **Google Sheets
   API** too, if you're using the ledger).
2. **APIs & Services → OAuth consent screen** → configure it (External is fine for a personal
   account) → add the Google account you'll use as a **test user**, and leave **Publishing
   status** as **Testing**. This is what keeps the app from needing Google's verification
   review — Testing apps skip that for up to 100 named test users, which is exactly this
   use case.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type
   **Desktop app**. Copy the **Client ID** and **Client Secret** into `server/.env` as
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Run `npm run google:auth` from `server/`. It prints a URL — open it, sign in with the account
   from step 2, approve access. It fills in `GOOGLE_OAUTH_REFRESH_TOKEN` for you; the value is
   never printed to the terminal.
5. Pick a Drive folder you already own for the archive, and put its ID (from its URL,
   `.../folders/THIS_PART`) in `GOOGLE_DRIVE_FOLDER_ID`. No sharing step — the app is
   authenticating as you, so it already has whatever access you have.

That's the required part. See [Transaction ledger](#transaction-ledger-google-sheets) below for
the one extra step if you also want the Sheets ledger.

### Startup checks

`npm start` refuses to bring the service up unless it can actually do its job. Before it
starts listening, it checks that the API keys, SMTP and Google Drive are all **configured**, and
then proves the mail and Drive credentials **work** — an SMTP login and a real request to the
Drive folder, not just that the values are non-empty.

Either check failing exits the process immediately with a specific reason, rather than starting
in a broken state that only becomes visible days later as a growing spool:

```
FATAL: production configuration is incomplete.

  - Google Drive archive not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, run `npm run google:auth` to get GOOGLE_OAUTH_REFRESH_TOKEN, and set GOOGLE_DRIVE_FOLDER_ID. See server/.env.example.
```

```
FATAL: configured credentials were rejected.

  - mail (smtp): FAILED — Invalid login: 535 authentication failed
```

A clean boot logs what was verified:

```
mail    -> smtp (verified)
archive -> Google Drive (verified)
sheets  -> not configured — skipping
```

### When mail is down

A submitted form is never lost. The customer is told to wait for the teller the moment they
submit, and the PDF only ever existed in their browser — so if delivery fails, the form is
written to `outbox/spool/<reference>/` with a manifest and the API still returns `200` with
`spooled: true`.

```bash
curl localhost:8787/api/spool              # what is waiting
curl -X POST localhost:8787/api/spool/flush # send it once mail is back
```

Delivered items move to `outbox/sent/`. `/api/health` reports the active transports and the
current spool depth, which is the thing worth alerting on.

Transient failures (SMTP 4xx, timeouts) are retried with exponential backoff and jitter.
Permanent ones (SMTP 5xx) are not retried — they will fail identically and the customer is
standing at the counter.

The customer's own copy is best effort: they typed that address on a tablet, so a typo is
reported in the response but never fails a deposit that has already been accepted and archived.

## Transaction ledger (Google Sheets)

Optional. On top of the PDF archive and the audit email, every submission can also be logged as
one row in a Google Sheet — a fast, searchable/filterable ledger that a folder of PDFs and an
inbox can't give you. It's additive, not a replacement for either: the PDF and the email are
still the operational record.

The row carries the same fields as the internal audit email (reference, account name and
number, amount, source of funds, processed-by phone, branch, Device ID, IP, consent, plus the
delivered/archived outcome) — the audit version, not the customer-facing one, so treat sharing
access to the sheet with the same care as the IT inbox.

**Setup:** uses the same authorization as Drive above — enable the **Google Sheets API**
alongside the Drive API in step 1 of [Setting up Google access](#setting-up-google-access), then:

1. Set `GOOGLE_SHEETS_SPREADSHEET_ID` from the sheet's URL (`.../spreadsheets/d/THIS_PART/edit`)
   — any spreadsheet you already own, no sharing step needed. `GOOGLE_SHEETS_TAB` defaults to
   `Transactions` — create a tab with that name, or set the variable to match one you already
   have.

Unlike mail and Drive, this is **optional and best-effort**: if it isn't configured, the
service starts normally and simply skips it (`sheetLogged: false, reason: 'not configured'` in
every response). If it *is* configured, startup still verifies the spreadsheet is reachable —
but a failure here only logs a warning, it never blocks the service from starting or a
submission from completing. A missed ledger row is an inconvenience; the PDF archive and the
audit email are what a lost transaction can't afford to skip, and those still fail loudly.

## Security

`SECURITY_AUDIT.md` has the full assessment and remediation record. The short version of how
the service is protected, and what you still have to get right at deploy time:

**Every endpoint requires a key.** Two tiers, kept separate on purpose:

| Endpoint | Key |
|---|---|
| `POST /api/submissions`, `GET /api/client-ip` | `API_KEYS` (tablets) |
| `GET /api/spool`, `POST /api/spool/flush` | `ADMIN_API_KEYS` (support/IT) |
| `GET /api/health` | none for `{ok:true}`; `ADMIN_API_KEYS` for full detail |

Send it as `Authorization: Bearer <key>` or `X-API-Key: <key>`:

```bash
curl -H "Authorization: Bearer $ADMIN_KEY" http://localhost:8787/api/spool
```

A tablet key deliberately cannot read or flush the spool — that endpoint lists queued
submissions and can trigger a mail send.

**Unconfigured means closed.** Leaving `API_KEYS` or `ADMIN_API_KEYS` blank does not disable the
check; the matching endpoints return 503. A banking endpoint that lost its credentials should
stop, not open. It is also the runtime backstop for any deployment that reaches a route without
having passed the boot preflight.

**CORS is not a security control.** `ALLOWED_ORIGINS` is a browser convenience and does nothing
against `curl` or a script. The keys are the boundary.

**Set `TRUST_PROXY` to the truth.** It decides how much of `X-Forwarded-For` the service
believes, and that decides whether the IP recorded on a form is evidence or decoration. `0` (the
default) means tablets connect directly and the header is ignored. Behind a reverse proxy such
as nginx, set the real hop count — otherwise you record the proxy's address.

### Things to know before going public

- **The tablet key lives in the bundle.** Vite inlines `VITE_API_KEY`, so anyone who can load
  the app can read it. Right control for a fixed fleet of branch tablets; not per-user auth.
  Keep the tablets on the branch network, give each deployment its own key, rotate on device
  loss. mTLS is the stronger option if you need it.
- **Rate limiting is per-instance and in-memory.** Any deployment running more than one process
  counts each separately, so the real ceiling is higher than configured. Use a shared store or
  an edge/WAF limit if the deployment is public.
- Run `npm test` in `server/` after touching validation — `src/security.test.js` is written as
  the attacks, so a regression fails the suite rather than production.

## Deployment

Production is a **single Vercel project** serving both halves from one origin: `web/dist` as
static output, and the Express app as one function at `/api/*` (`api/index.js`). One origin
means no CORS to get wrong — `ALLOWED_ORIGINS`, `VITE_API_BASE` and the deployment URL are all
the same value.

`deploy.md` is the runbook and is the authority; §0 records why Vercel, and what is weaker
because of it. Three things about it differ from running on a normal server, and all three are
easy to get wrong silently:

- **`TRUST_PROXY=1` is mandatory.** The function always sits behind Vercel's proxy. Left at `0`,
  the IP written onto every audit mail, ledger row and PDF is that proxy rather than the tablet,
  and per-IP rate limiting collapses into a single shared bucket.
- **`SPOOL_DRIVER=blob` is mandatory.** The filesystem is read-only apart from `/tmp`, and `/tmp`
  dies with the container — so the fs spool would quietly destroy forms a customer had already
  submitted. The blob driver needs a Vercel Blob store connected to the project.
- **`ALLOWED_CIDRS` / `ADMIN_CIDRS` are mandatory.** `middleware.js` enforces the source-IP
  allowlist that nginx used to hold. `VITE_API_KEY` is inlined into the public bundle by design,
  so without the allowlist anyone who can load the app can read the key and call the API.

All three fail closed rather than degrading: the build refuses without a Blob token, and the
middleware denies with an unset allowlist.

The build command runs `npm run preflight` before building, so a deploy whose SMTP or Drive
credentials are rejected **fails rather than going live** — the serverless stand-in for the
boot check in `server/src/preflight.js`. It verifies at deploy time only; watch
`/api/health/detail` for credentials that expire later.

The VPS + nginx path (`server/src/index.js`, `SPOOL_DRIVER=fs`) still works and is still
documented in `deploy.md` §2 and §7-§9.

## Notes for whoever picks this up

- **Account number mask.** `ACCOUNT_MASK` in `web/src/lib/format.ts` is the single place that
  defines the 3-7-2-4-2 grouping.
- **Amounts.** LAK is treated as a zero-decimal currency; USD, THB and EUR carry two. Grouping is
  standard: `2000000` displays as `2,000,000`.
- **Fonts.** `web/public/fonts` holds Latin and Lao subsets, used both by the UI and embedded into
  the PDF, so screen and document match. Regenerate with `web/scripts/build-fonts.sh`. Two
  deliberate choices are documented there and in `web/src/lib/pdf.ts`: the fonts are embedded whole
  (pdf-lib's runtime subsetter drops glyphs from these faces), and the Latin subsets carry no
  ligature features (a subset "fi" ligature comes out with the wrong advance).
- **Lao in the PDF.** pdf-lib substitutes glyphs but ignores GPOS offsets, which leaves Lao vowel and
  tone marks stranded beside their base letter. `drawShapedText` in `web/src/lib/pdf.ts` lays the
  text out with fontkit and places each glyph itself.
- **PDF weight.** A completed form with a photo and signature is around 160 kB. pdf-lib is loaded on
  demand, so the initial app download stays near 75 kB gzipped.
