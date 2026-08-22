# Penetration Testing & Security Audit — BFL BRED Group Cash Form

**Target:** `BFL_Bred_Group` (React tablet front-end + Node/Express submission service)
**Assessment type:** White-box source review + local exploit verification
**Date:** 2026-08-20
**Assessed by:** Security review (authorized, project owner requested)
**Status:** All findings remediated — see [Remediation status](#remediation-status)

> Scope note: This was a static/white-box assessment of the repository with local
> proof-of-concept verification of the reachable code paths. No testing was
> performed against a live production host. Findings are ordered by severity.

---

## Executive summary

The application is a bank branch tool: a tablet renders a cash deposit/withdrawal
PDF and posts it to an Express service, which emails an audit copy to
`it.support@bfl.la`, archives the PDF to Google Drive, and optionally logs a row
to Google Sheets.

The code is careful in several places that commonly go wrong — HTML in emails is
escaped, Google Sheets writes use `RAW` (blocking formula/CSV injection), OAuth
secrets are read from the environment and never committed, and there are no
vulnerable npm dependencies. **However, the entire HTTP API is unauthenticated
and unthrottled**, which turns the service into an open abuse surface, and there
is an **unauthenticated path-traversal / arbitrary-file-write** in the spool
subsystem.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | No authentication on any API endpoint | ✅ Fixed |
| 2 | **High** | Path traversal → arbitrary file write via spool (`referenceNo` / filename) | ✅ Fixed |
| 3 | **High** | Open email relay: arbitrary recipient + attacker-controlled content via `copyToEmail` | ✅ Fixed |
| 4 | **Medium** | No rate limiting → mail-bomb / resource-exhaustion amplification | ✅ Fixed |
| 5 | **Medium** | Audit provenance IP is attacker-spoofable (`trust proxy` + `X-Forwarded-For`) | ✅ Fixed |
| 6 | **Medium** | Sensitive operational endpoints exposed (`/api/spool`, `/api/spool/flush`, `/api/health`) | ✅ Fixed |
| 7 | **Low** | Internal error messages returned to clients | ✅ Fixed |
| 8 | **Low** | No HTTP security headers (no `helmet`) | ✅ Fixed |
| 9 | **Low** | Uploaded "PDF" content type/magic bytes not validated | ✅ Fixed |
| 10 | **Info** | CORS is not an access control; provides no protection here | ✅ Documented |

**Positives observed** (no action needed): email HTML escaping (`mail/messages.js`),
Google Sheets `RAW` value input mode (`sheets.js`) preventing spreadsheet injection,
no secrets in git history, `.env*` git-ignored, `npm audit` clean for both packages.

---

## 1. Critical — No authentication on any API endpoint

**Location:** `server/src/app.js` (all routes)

Every route is served with no authentication, API key, or session:

```
POST /api/submissions      GET /api/spool
POST /api/spool/flush       GET /api/client-ip     GET /api/health
```

The only network control is a CORS `origin` allowlist, which is **not** an
authentication mechanism — CORS is enforced by browsers only and is trivially
bypassed by any non-browser client (`curl`, script, Burp). Anyone able to reach
the host/port can invoke every endpoint.

**Impact:** This is the root enabler for findings #2, #3, #4, and #6. An attacker
on the branch LAN (or the public internet if the Vercel/VPS deployment is exposed)
can forge submissions, enumerate the spool, trigger mail flushes, and reach the
file-write bug below.

**Recommendation:**
- Require a shared secret / device credential (per-tablet API key or mTLS) on
  `POST /api/submissions` and `GET /api/client-ip`.
- Put the operational endpoints (`/api/spool`, `/api/spool/flush`, `/api/health`)
  behind a separate admin credential and never expose them to the tablet network.
- Bind the service to the branch VLAN only; do not expose it publicly.

---

## 2. High — Path traversal → arbitrary file write (spool)

**Location:** `server/src/spool.js` → `spool()`, reached from `server/src/app.js`
and `server/src/mailer.js`

`spool()` builds filesystem paths directly from two fully attacker-controlled
values with **no sanitization**:

- `payload.meta.referenceNo` — sent by the client in the JSON payload.
- `fileName` = `file.originalname` — the uploaded multipart filename.

```js
const dirFor = (referenceNo) => join(spoolRoot(), referenceNo)
// ...
await writeFile(join(dir, fileName), pdf)          // pdf = attacker-controlled bytes
await writeFile(join(dir, 'manifest.json'), ...)
```

`app.js` only checks that `referenceNo` is truthy — it is never validated against
a format or stripped of `../`.

**Verified locally** (path resolution, not a live host):

```
referenceNo = '../../../../tmp/pwned'   fileName = '../../../../tmp/evil.pdf'

spool dir  ->  ../../tmp/pwned
pdf write  ->  ../../../../tmp/evil.pdf     <-- escapes outbox, arbitrary location
manifest   ->  ../../tmp/pwned/manifest.json
```

Because the PDF body is arbitrary bytes chosen by the attacker, this is an
**arbitrary-content, arbitrary-path file write** with the privileges of the Node
process. On the VPS/`index.js` deployment this can overwrite application source,
drop a file into a served directory, or clobber config. `listSpool()` and
`flushSpool()` then walk whatever directory names exist, compounding the effect.

**Reachability:** the write executes on the spool path, i.e. whenever mail
delivery fails (`mailer.js` catch) or `sendSubmission` throws (`app.js` catch).
The spool exists precisely to absorb mail outages, so during any such outage
every attacker-submitted form exercises the vulnerable write. Treat as reachable.

**Recommendation:**
- Reject `referenceNo` that does not match a strict allowlist, e.g. `^[A-Za-z0-9._-]{1,64}$`.
- Never use the client `originalname` for a filesystem path — derive the on-disk
  name from a server-generated id, or `path.basename()` it and re-validate.
- Defense in depth: resolve the final path and assert it stays within
  `path.resolve(spoolRoot())` before writing.

---

## 3. High — Open email relay (arbitrary recipient + content)

**Location:** `server/src/mailer.js`, `server/src/mail/messages.js` (`customerMessage`)

`POST /api/submissions` accepts `copyToEmail` and sends a "customer copy" to it
with **no validation of the address** and with message fields (`accountName`,
amount, `sourceOfFunds`, etc.) taken from the request:

```js
const recipients = [config.mail.to, ...(customer ? [payload.copyToEmail] : [])]
// messages.js:  to: [payload.copyToEmail]
```

Combined with #1 (no auth), any anonymous caller can make the service send mail
**from the bank's own authenticated SMTP account and `no-reply@bfl.la` sending
domain** to an arbitrary recipient, containing an arbitrary PDF attachment and
attacker-influenced body text. This is a spam / phishing relay that abuses the
bank's mail reputation and SPF/DKIM alignment, and it also lets an attacker flood
`it.support@bfl.la` and poison the audit trail (Drive + Sheets) with forged
"transactions."

The HTML body is correctly escaped (good — prevents HTML injection into the
message), but that does not mitigate the relay/abuse itself.

**Recommendation:**
- Validate `copyToEmail` against a strict email pattern and reject multiple
  addresses / header characters (`\r`, `\n`, `,`, `;`, `<`, `>`).
- Gate the endpoint behind auth (#1) and rate limiting (#4).
- Consider a per-day send cap per device and alerting on volume anomalies.

---

## 4. Medium — No rate limiting (mail-bomb / resource exhaustion)

**Location:** `server/src/app.js` (no `express-rate-limit` or equivalent)

Each `POST /api/submissions` triggers up to two outbound emails (with retries),
a Google Drive upload, and a Google Sheets append. `POST /api/spool/flush`
re-sends the entire backlog. With no throttling and no auth (#1), a loop of
requests amplifies into mail volume, Drive/Sheets API quota consumption, and
memory pressure (12 MB in-memory upload each).

**Recommendation:** add `express-rate-limit` per IP/device on `submissions` and
`spool/flush`; cap request body/JSON size; alert on spool growth.

---

## 5. Medium — Audit provenance IP is spoofable

**Location:** `server/src/app.js` — `app.set('trust proxy', true)` + `clientIp()`

`trust proxy` is set to boolean `true` (trust *all* hops) and `clientIp()` reads
the client-supplied `X-Forwarded-For` header, taking the first token. The
resulting IP is written into the audit email and the Sheets ledger and is
described in-code as the trustworthy value ("the connection is the truth"). In
fact, any caller can set `X-Forwarded-For: 1.2.3.4` and fully control the
recorded IP. For a record that is meant to stand in for a wet signature, a
forgeable provenance field weakens the audit integrity claim.

**Recommendation:** set `trust proxy` to the specific number of trusted proxies
(or the reverse-proxy IP), and derive the IP from `req.ip` after that, rather than
parsing the raw header. If tablets connect directly, do not trust `X-Forwarded-For`
at all.

---

## 6. Medium — Sensitive operational endpoints exposed

**Location:** `server/src/app.js`

- `GET /api/spool` returns every queued submission's `referenceNo`, `fileName`,
  and failure `reason` — enumeration of pending transaction references.
- `POST /api/spool/flush` lets anyone trigger backlog delivery (abuse/amplification).
- `GET /api/health` discloses mail transport list, configured/not-configured
  Sheets state, and current spool depth — useful reconnaissance.

**Recommendation:** move these behind admin auth (#1) and restrict to an internal
management network.

---

## 7. Low — Internal error messages leaked to clients

**Location:** `server/src/app.js` — `res.status(500).json({ error: error.message })`

Raw exception messages (which may include upstream Drive/SMTP status text, URLs,
or internal detail) are returned to the caller. Return a generic message and log
the detail server-side only.

## 8. Low — No HTTP security headers

No `helmet` (or equivalent). Add it to set `X-Content-Type-Options: nosniff`,
`X-Frame-Options`/frame-ancestors, HSTS (behind TLS), and a restrictive referrer
policy. Low direct risk for a JSON API but cheap hardening.

## 9. Low — Uploaded content not validated as PDF

`multer` accepts any bytes under the field name `pdf`; the content is never
checked for the `%PDF` magic or a real content type before being emailed and
archived. Combined with #1/#3 this lets arbitrary payloads be laundered through
the bank's Drive/mail. Validate magic bytes and enforce `application/pdf`.

## 10. Info — CORS is not access control

`cors({ origin: config.allowedOrigins })` restricts *browser* cross-origin reads
only. It is not authentication and does not stop `curl`/scripted abuse of any
endpoint. Do not rely on it as a security boundary.

---

## Not vulnerable / done well

- **Spreadsheet injection** — `sheets.js` uses `valueInputOption=RAW`, and the
  code comments show the risk was understood; customer free-text and `+`-prefixed
  phone numbers are stored literally, not evaluated. ✅
- **HTML/email injection** — `escapeHtml()` is applied to every field rendered
  into the HTML mail bodies. ✅
- **Secret management** — OAuth client/secret/refresh token and SMTP creds are
  read from env; `.env*` is git-ignored; git history contains no committed
  secrets (only `.env.example` templates). ✅
- **Dependencies** — `npm audit` reports 0 vulnerabilities for both `server/` and
  `web/`. ✅
- **Reference collision handling** — `makeReference()` uses timestamp-to-second
  plus random hex, addressing the earlier birthday-collision risk. ✅

---

## Remediation status

All ten findings were fixed in this branch. New modules: `server/src/auth.js`
(credential checks) and `server/src/validate.js` (input validation at the trust
boundary). Regression tests live in `server/src/security.test.js` — each is
written as the attack, so reopening a hole fails the suite (`npm test`, 14/14
passing).

| # | Fix | Where |
|---|-----|-------|
| 1 | Two-tier API keys (device / admin), timing-safe compare, **fails closed** — unconfigured keys return 503, never open access | `auth.js`, `app.js`, `config.js` |
| 2 | `referenceNo` anchored allowlist (`..` unrepresentable); client filename reduced to a plain segment; `assertWithin()` proves every write stays under the spool root — enforced at the route *and* in `spool.js` | `validate.js`, `spool.js`, `app.js` |
| 3 | Strict `copyToEmail` pattern rejecting CR/LF, comma, semicolon and angle brackets; re-checked in `mailer.js` because replayed spool manifests bypass the route | `validate.js`, `app.js`, `mailer.js` |
| 4 | `express-rate-limit` per IP, with a tighter cap on submissions; multer `files`/`fields`/`fieldSize` caps added | `app.js`, `config.js` |
| 5 | `trust proxy` now driven by `TRUST_PROXY`, defaulting to `0`; IP read from `req.ip` instead of the raw header | `config.js`, `app.js` |
| 6 | Spool endpoints require the admin key; `/api/health` returns `{ok:true}` anonymously and full detail only to an admin | `app.js` |
| 7 | Generic 500 bodies; full detail logged server-side. Added a multer error handler so a bad upload can't produce an HTML stack page | `app.js` |
| 8 | `helmet()` enabled, `x-powered-by` disabled | `app.js` |
| 9 | `%PDF-` magic-byte check before the upload is emailed or archived | `validate.js`, `app.js` |
| 10 | CORS documented as a browser convenience, not a control | `app.js`, `.env.example` |

### Verified against a running server

```
401  GET  /api/spool        (no key)        401  GET  /api/spool  (device key — no escalation)
200  GET  /api/spool        (admin key)     503  any endpoint when keys are unconfigured
400  traversal referenceNo   -> Missing or invalid meta.referenceNo
400  non-PDF upload          -> Uploaded file is not a PDF
400  CRLF header injection   -> Invalid copyToEmail address
400  a@b.com, c@d.com        -> Invalid copyToEmail address
429  submissions past the configured cap
200  /api/client-ip with `X-Forwarded-For: 1.2.3.4` -> {"ip":"127.0.0.1"}   (spoof ignored)
     x-content-type-options: nosniff | x-frame-options: SAMEORIGIN | HSTS set | x-powered-by absent
```

### Residual risk — read before deploying

- **The tablet API key is not a secret.** Vite inlines `VITE_API_KEY` into the
  built bundle, so anyone who can load the app can extract it. It raises the
  bar from "anonymous internet" to "someone who reached the app", which is the
  right control for a fixed fleet of branch tablets — but it is not per-user
  authentication. Keep the tablets on the branch network, give each deployment
  its own key, and rotate on device loss. Per-device certificates (mTLS) are
  the stronger option if the threat model needs it.
- **Rate limiting is per-instance and in-memory.** Any deployment running more
  than one process counts each separately, so the effective ceiling is higher
  than configured. Use a shared store (Redis) or an edge/WAF rate limit if the
  deployment is public.
- **Set `TRUST_PROXY` to match reality.** It defaults to `0` (no proxy). Behind
  a reverse proxy such as nginx, leaving it at `0` records the proxy's address
  rather than the tablet's — correct but less useful. Set it to the real hop
  count.
- **Any deployment that skips the boot preflight** surfaces misconfiguration as
  503s at request time rather than a refused boot. The fail-closed auth is what
  keeps that safe.
- Not covered by this assessment: infrastructure and TLS configuration, the
  Google account's own security posture, and the physical security of the
  branch tablets.
