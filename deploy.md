# Production deployment — `forms.bfl.la`

Runbook for taking the BFL cash deposit / withdrawal app from a laptop and a throwaway demo
to a real, hardened, bank-operated deployment. Written to be executed **once**, in order, by
whoever at BFL holds DNS, Google Workspace, mail-system and hosting access.

Read §0 and §1 completely before touching anything. §1 is a gate: the service must not be
given a public hostname until every item in it is closed.

---

## §0 · Scope and decisions

### What gets hosted

| Component | What it is | Where it runs |
|---|---|---|
| `server/` | Express submission service — receives the form, sends mail, archives the PDF to Drive, appends the ledger row | Vercel function (`api/index.js`), Node 22 |
| `web/dist` | The tablet UI — React + Vite static build | Vercel static output, same project and same origin |

Three external dependencies: an **SMTP relay** (required), **Google Drive** (required — the
service refuses to build without it), **Google Sheets** (optional ledger). Plus a **Vercel Blob
store**, which is where the spool lives.

### Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Hosting | **Vercel — one project, both halves** | *Reversed 2026-08-23 (see below).* Static output and the function share an origin, so §3.4's one-origin argument still holds without nginx. |
| Vercel | **The production target** | Superseded the VPS decision on 2026-08-23. The two objections below were conditions, not blockers, and both are now closed in code. |
| Domain | **`forms.bfl.la`** | App and API share one origin, so there is no cross-origin configuration to get wrong. |
| Google identity | **Service account + Shared Drive** | Production access must belong to the bank, not to one employee's Google session. Requires the code change in §4.0. |
| API access control | **Four layers** — source-IP allowlist · device key header · separate admin token for ops routes · rate limiting and header hardening | See §1-S1 and §9. The allowlist moved from nginx to `middleware.js`. |
| Spool durability | **Vercel Blob** (`SPOOL_DRIVER=blob`) | See below. |
| Boot preflight | **Deploy-time, in the build command** | See below. |

#### The 2026-08-23 reversal — what changed and what did not

This document previously recorded Vercel as demo-only, to be decommissioned, on two grounds.
Both were real. Both are now addressed, and neither is addressed by ignoring it:

- **"Its filesystem is ephemeral, so a spooled form is silently destroyed when the container
  recycles."** Still true of the filesystem. `server/src/spool.js` is now a driver facade:
  `spool/fs.js` is unchanged and remains the default, and `spool/blob.js` puts the PDF and its
  manifest in Vercel Blob, which outlives the invocation. `SPOOL_DRIVER=blob` selects it, and
  the service refuses to start with that set and no `BLOB_READ_WRITE_TOKEN`.
- **"Its entry point deliberately skips `assertReady()`."** Still true, and still unavoidable —
  a serverless invocation has no boot to refuse. The check moved to the two moments that do
  exist: `npm run preflight` runs inside the Vercel build command, so credentials Drive or SMTP
  reject fail the deploy rather than going live; and `auth.js` fails closed at request time.

**What is genuinely weaker than the VPS design, and stays weaker:**

1. A credential accepted at build time and revoked afterwards is not caught automatically.
   Monitor `/api/health/detail`; a successful deploy is not a standing guarantee.
2. Blob storage has no atomic `rename()`, so `flushSpool` copies then deletes. A crash between
   the two leaves a form in both `spool/` and `sent/` — duplicated, never lost. The direction is
   deliberate.
3. The in-process rate limiter counts per instance, so a scaled-out deployment's real ceiling is
   higher than configured (§9.2's edge limits were nginx's job — use Vercel Firewall rules).
4. Spooled manifests hold complete customer payloads, so §12's retention purge needs a
   Vercel-side equivalent over the `sent/` prefix.

The VPS path is not deleted and not broken: `server/src/index.js`, `assertReady()` and the fs
spool driver all still work, and §2 and §7-§9 below remain accurate for that deployment.

### Rules for this document

- **No real secret ever appears here.** Every credential is written as `<from §N>`. Real
  values go straight into `/etc/bfl-cash-form/server.env` (§6) — never into this file, never
  into a commit, never into a chat log, a ticket or a screenshot.
- Placeholders to substitute as you go: `<VPS_IP>`, `<BRANCH_CIDR>`, `<IT_ADMIN_CIDR>`.
- Commands shown with `sudo` run on the VPS. Everything else runs on the workstation doing
  the setup.

### Supersedes

`prod_setup.md` is replaced by this file and is deleted in §11-B. Where the two disagree,
this file is correct.

---

## §1 · BLOCKING pre-deploy work

Everything below is a **defect that must be fixed before the service is reachable from a
public hostname**. Each item states what is wrong, exactly where, the fix, and how to prove
the fix works. This document specifies them; it does not apply them.

Track them as a checklist — the go/no-go gate in Appendix D requires all twelve closed.

### S1 · No authentication on any route — critical

`server/src/app.js:32-122` registers five routes and not one of them checks who is calling.

| Route | Line | What an anonymous caller on the internet can do |
|---|---|---|
| `POST /api/submissions` | `:60` | Inject forged deposit/withdrawal records into `it.support@bfl.la`, into the Drive archive and into the Sheets ledger. Also a mail-bomb and Drive-quota exhaustion vector. |
| `GET /api/spool` | `:46` | Read reference numbers, filenames and failure reasons for **real customers'** undelivered forms. |
| `POST /api/spool/flush` | `:51` | Trigger outbound mail on demand. |
| `GET /api/health` | `:32` | Enumerate mail transports, archive backend, whether Sheets is configured, and the current queue depth. |
| `GET /api/client-ip` | `:43` | Minor, but an unauthenticated echo endpoint. |

**Fix — two middlewares in `server/src/app.js`:**

1. `requireDeviceKey` — compares the `X-BFL-Device-Key` header against the `DEVICE_KEY`
   env var with `crypto.timingSafeEqual` over equal-length buffers. Applied to
   `POST /api/submissions` and `GET /api/client-ip`. Responds `401` with a generic body.
2. `requireAdminToken` — compares `Authorization: Bearer <token>` against `ADMIN_TOKEN` the
   same way. Applied to `GET /api/spool`, `POST /api/spool/flush`, and a new
   `GET /api/health/detail`.

Reduce the public `GET /api/health` to exactly `{"ok":true}` — enough for an uptime probe,
nothing an attacker can inventory. Move the current detailed body behind `requireAdminToken`.

**Be honest about what the device key is worth.** It is compiled into the browser bundle, so
anyone who can load the app can read it. It stops opportunistic abuse of a URL that leaks; it
is *not* authentication. **The source-IP allowlist in §9 is the real control.** The two are
complementary: the allowlist stops the internet, the key stops a stray device inside the
allowed network.

**Accept:** `POST /api/submissions` with no key → `401`. `GET /api/spool` with no token →
`401`. `GET /api/health` → `{"ok":true}` and nothing more.

### S2 · Path traversal in the spool — critical

`server/src/spool.js:12,18-27`:

```js
const dirFor = (referenceNo) => join(spoolRoot(), referenceNo)   // :12
await writeFile(join(dir, fileName), pdf)                        // :21
```

Both path components are attacker-controlled. `referenceNo` comes straight out of the
client's JSON payload (`app.js:69-72` — checked only for *presence*), and `fileName` is
multer's `file.originalname` (`app.js:78`), which is whatever the uploader put in the
multipart headers. A submission carrying

```
meta.referenceNo = "../../../../home/bflapp/.ssh"
pdf filename     = "authorized_keys"
```

writes attacker-controlled bytes outside the outbox, as the service user. `flushSpool`
(`spool.js:63-93`) then reads those paths back. This is a remote arbitrary-file-write, and
because of S1 it needs no credentials at all.

**Fix:**

- Validate the reference against the exact shape the client generates — `makeReference` in
  `web/src/lib/device.ts:65-72` emits `BFL` + 14 digits + 6 uppercase hex characters:

  ```js
  const REFERENCE = /^BFL\d{14}[0-9A-F]{6}$/
  if (!REFERENCE.test(payload.meta?.referenceNo ?? '')) {
    return res.status(400).json({ error: 'Invalid reference' })
  }
  ```

  Validate in `app.js` **and** defensively again inside `spool.js`, so no future caller can
  reintroduce the hole.
- Never use `originalname` as a path component. Derive the stored name server-side:
  `` const fileName = `${payload.meta.referenceNo}.pdf` ``

**Accept:** a `POST` whose `meta.referenceNo` is `../../../../tmp/pwn` returns `400`, and
`sudo find / -name 'pwn*' -newermt '-5 min'` finds nothing.

### S3 · Unsanitized filename reaches Drive and the mail attachment — high

The same untrusted `originalname` flows into the Drive file metadata (`server/src/drive.js:14`,
`name: fileName`) and the SMTP attachment name (`server/src/mail/smtpSend.js:60`). The
server-side derivation in S2 fixes all three call sites at once, since they read the same
variable.

### S4 · No upload validation — high

`app.js:70-71` checks only that a `pdf` part exists. Any bytes are accepted, attached to a
bank audit email and uploaded to the archive.

**Fix:** assert the file begins with `%PDF-`
(`file.buffer.subarray(0, 5).toString() === '%PDF-'`), `400` otherwise. Lower the multer
limit from 12 MB (`app.js:24`) to **5 MB** — a completed form with photo and signature is
about 160 kB (`README.md:238`), so 5 MB is already 30× headroom.

### S5 · Customer face photo and signature are uploaded, then discarded — high (privacy)

`app.js:62-66` declares `photo` and `signature` multer fields. **Nothing in the codebase ever
reads `req.files.photo` or `req.files.signature`** — yet `web/src/lib/submit.ts:68-69`
uploads both on every single submission. Both are already embedded in the PDF sent alongside
them.

So a photograph of the customer's face and their handwritten signature cross the network and
sit in the service's memory, twice over, for no purpose at all. A data-protection finding
with no functional upside.

**Fix:** delete lines 68-69 of `web/src/lib/submit.ts`, and reduce `app.js:62-66` to
`upload.single('pdf')`. Requests get smaller and the attack surface shrinks with them.

### S6 · `trust proxy` is blanket-true — high

`app.js:20` sets `app.set('trust proxy', true)`. `clientIp()` (`app.js:26-30`) therefore
returns whatever `X-Forwarded-For` the caller chooses to send. That forged value is written
into the audit email (`server/src/mail/messages.js:87`), the Sheets ledger
(`server/src/sheets.js:26`) and the customer's PDF — meaning the IP recorded on a financial
record is unconditionally attacker-controlled. It also defeats per-IP rate limiting.

**Fix:** `app.set('trust proxy', 1)` — exactly one hop, the nginx in §8. Express then takes
the last entry in the chain, which nginx sets from the real socket.

### S7 · Internal error text returned to the caller — medium

`app.js:119` returns `{ error: error.message }`. Those messages embed verbatim upstream
response bodies: `drive.js:47` interpolates Drive's API error, `sheets.js:71` does the same
for Sheets, and SMTP failures carry the relay's banner and response codes.

**Fix:** generate a correlation id, log the full error server-side against it, return
`{ error: 'Submission failed', ref: '<id>' }`.

### S8 · No payload schema validation — medium

`app.js:69` does `JSON.parse(req.body.payload ?? '{}')` followed by exactly three checks (pdf
present, reference present, consent truthy). Everything else goes unvalidated into an email, a
spreadsheet and a PDF. Multer's default `fieldSize` is 1 MB, so a 1 MB `sourceOfFunds` is
accepted where the UI caps at 500 characters (`README.md:66`).

**Fix:** explicit multer limits —
`limits: { fields: 1, fieldSize: 65536, files: 1, fileSize: 5 * 1024 * 1024 }` — plus a
validation pass over the payload: type checks and length caps matching the UI
(`accountName` ≤ 140, `sourceOfFunds` ≤ 500, `accountNumber` exactly 18 digits,
`amountCurrency` one of LAK/USD/THB/EUR, `kind` one of deposit/withdrawal), `400` on anything
that fails.

### S9 · No rate limiting, no security headers — medium

Add `express-rate-limit`: ~20 requests/minute per IP on `/api/submissions`, ~5/minute on the
admin routes. Add `helmet` for defence in depth even though nginx sets headers too (§8) — the
app should not depend on the proxy for its own safety. Both are new dependencies; re-run the
audit in S12 afterwards.

### S10 · Restore the deleted test suite — high

`README.md:107` and the comment at `server/src/mail/messages.js:9` both state that
`messages.test.js` **fails if the Device ID, IP address or consent line leaks into a
customer-facing email**. That test does not exist. The entire suite was deleted in commit
`fdb201a` ("rm-test-file"):

```
server/src/config.test.js          server/src/sheets.test.js
server/src/drive.test.js           server/src/spool.test.js
server/src/mail/messages.test.js   web/src/lib/amountInWords.test.ts
server/src/preflight.test.js       web/src/lib/format.test.ts
server/src/retry.test.js
```

A documented PII guarantee for a bank is currently enforced by nothing. Restore it:

```bash
git checkout fdb201a^ -- server/src/mail/messages.test.js server/src/spool.test.js
```

Restore the rest the same way, then add regression tests for S2 (traversal reference is
rejected) and S1 (unauthenticated request is refused). `npm test` must be green in both
packages before go-live.

### S11 · Pin the Node runtime — low

`server/package.json` has no `engines` field, but `npm start` uses `--env-file-if-exists`,
which needs Node ≥ 20.6. Add `"engines": { "node": ">=22" }` so a mismatched host fails at
install rather than at runtime.

### S12 · Dependency audit — low

Install from the committed lockfile only (`npm ci`), then:

```bash
cd server && npm audit --omit=dev
```

```bash
cd web && npm audit
```

Current: express 5.2.1, multer 2.2.0, nodemailer 9.0.5. Both must come back clean, or each
finding must be explicitly accepted in writing, before go-live.

### Verified good — do not "improve" these

Three things are already correct in ways that are easy to undo by accident:

- **`server/src/sheets.js:63` uses `valueInputOption=RAW`.** This is the only thing standing
  between a 500-character customer-typed free-text field and live formula injection into a
  financial audit log. Never change it to `USER_ENTERED`.
- **`server/src/mail/messages.js:12-17` escapes `& < > "` for the HTML mail.** Values are only
  ever placed in text nodes, which makes that set sufficient. If anyone moves an interpolation
  into an HTML *attribute*, `'` must be escaped too.
- **`server/src/preflight.js` refuses to boot on rejected credentials.** Keep that behaviour in
  `server/src/index.js`. The serverless entry point (`api/index.js`) cannot use it — there is no
  boot to refuse — so it runs as `npm run preflight` inside the Vercel build command instead.
  Do not "simplify" that out of `vercel.json`: without it nothing checks the credentials before
  a deployment goes live.

---

## §2 · Provision and harden the VPS

A small VPS is plenty: this is a low-traffic internal tool. Ubuntu 24.04 LTS, 1 vCPU, 2 GB
RAM. Harden **before** installing anything.

### 2.1 SSH

```bash
sudo passwd -l root
```

In `/etc/ssh/sshd_config` set:

```
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
```

```bash
sudo systemctl restart ssh
```

Confirm you still have a working key-based session in a second terminal **before** closing
the first one.

### 2.2 Firewall

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Port 8787 is deliberately **not** opened — the Node service binds to loopback and is only
reachable through nginx.

### 2.3 Automatic patching and brute-force protection

```bash
sudo apt-get update && sudo apt-get install -y unattended-upgrades fail2ban
```

```bash
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

`fail2ban`'s default `sshd` jail is sufficient.

### 2.4 Service user

Never run Node as root:

```bash
sudo adduser --system --group --home /opt/bfl-cash-form bflapp
```

### 2.5 Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

```bash
node --version
```

Must report ≥ 20.6; 22.x is the target (see S11).

### 2.6 nginx and certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 2.7 The PII directory

The spool holds **complete customer payloads plus the signed PDF, unencrypted**
(`server/src/spool.js:22-25`). It lives outside the git checkout so that a `git pull` or a
redeploy can never touch queued forms:

```bash
sudo mkdir -p /var/lib/bfl-cash-form/outbox && sudo chown -R bflapp:bflapp /var/lib/bfl-cash-form && sudo chmod 700 /var/lib/bfl-cash-form/outbox
```

Put this on an encrypted volume if BFL's policy requires encryption at rest, and set a
retention/purge policy for `outbox/sent/` (§12).

### 2.8 Get the code onto the server

```bash
sudo mkdir -p /opt/bfl-cash-form && sudo chown bflapp:bflapp /opt/bfl-cash-form
```

```bash
sudo -u bflapp git clone https://github.com/Akomder/BFL_Bred_Group.git /opt/bfl-cash-form
```

If the repository is private, use a **read-only deploy key** scoped to this one repo
(GitHub → repo → Settings → Deploy keys), never a personal account's credentials — it can be
revoked independently of any employee.

---

## §3 · DNS, TLS and email-domain authentication

### 3.1 DNS records

| Type | Name | Value | Purpose |
|---|---|---|---|
| `A` | `forms.bfl.la` | `<VPS_IP>` | The app |
| `AAAA` | `forms.bfl.la` | VPS IPv6, if any | Same |
| `CAA` | `bfl.la` | `0 issue "letsencrypt.org"` | Only Let's Encrypt may issue certificates for the zone |

Verify propagation before continuing:

```bash
dig +short forms.bfl.la
```

### 3.2 Certificate

After the nginx site from §8 is in place:

```bash
sudo certbot --nginx -d forms.bfl.la
```

Certbot rewrites the site config to add the HTTPS block and the redirect, and installs a
renewal timer. Confirm it:

```bash
systemctl list-timers | grep certbot
```

### 3.3 SPF, DKIM and DMARC for `bfl.la` — do not skip

The service sends **customer-facing** advice mail from `no-reply@bfl.la`. Without domain
authentication those messages land in spam, and the bank's domain stays trivially spoofable.
With BFL's mail administrator, confirm on the `bfl.la` zone:

- **SPF** — a single `TXT` record including the §5 relay, ending `-all` (hard fail).
- **DKIM** — signing enabled on the sending mailbox, with the selector's public key published.
- **DMARC** — a `_dmarc.bfl.la` `TXT` record at minimum `p=quarantine` with an `rua=` address
  a person actually monitors. `p=none` is a measurement mode, not a policy.

Verify by sending one message to an external mailbox and reading its `Authentication-Results`
header — all three must say `pass`.

### 3.4 Why one origin

App and API share `https://forms.bfl.la`, so §6 sets `VITE_API_BASE=https://forms.bfl.la` and
`ALLOWED_ORIGINS=https://forms.bfl.la` — one value each, no ambiguity.

Note explicitly: **CORS is a browser-side control and is not access control.** `curl` ignores
it entirely. The controls that matter are S1's middlewares and §9's allowlist.

---

## §4 · Google — service account and Shared Drive

One Google identity backs both the required PDF archive (Drive) and the optional ledger
(Sheets).

### 4.0 Prerequisite code change

`server/src/google.js:18-44` currently performs only the OAuth **refresh-token** grant, i.e.
the app acts as one person's Google account. Production needs a service account. The change
is roughly twenty lines:

- Add a service-account branch that builds and signs a JWT (`RS256`; `iss` = the service
  account email; `scope` = `https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets`;
  `aud` = `https://oauth2.googleapis.com/token`; one-hour expiry) using `GOOGLE_PRIVATE_KEY`,
  then exchanges it at the **same** token endpoint already used at `google.js:21`.
- Keep the existing token cache (`google.js:16,42`) exactly as it is.
- Pick whichever credential is configured, preferring the service account.
- `server/src/config.js:44-62` gains `clientEmail` and `privateKey`; `isGoogleAuthConfigured()`
  at `config.js:80-85` must accept **either** credential shape.
- Nothing downstream changes: `drive.js`, `sheets.js` and `preflight.js` all go through
  `getGoogleToken()`.

Do not start 4.1 assuming this is done — confirm it with whoever maintains the code.

### 4.1 Create the Shared Drive

In [drive.google.com](https://drive.google.com), signed in as a BFL Workspace admin:
**Shared Drives → New**, name it `BFL Cash Forms`.

A Shared Drive has **its own storage**, independent of any individual's quota. This is
precisely what a service account lacks on a personal Drive, and the reason the current code
uses a personal OAuth grant instead — it is the dead end described in `README.md:118-122`.

### 4.2 Cloud project and APIs

1. In [console.cloud.google.com](https://console.cloud.google.com), under BFL's Workspace
   organisation, create a project, e.g. `bfl-cash-form-prod`.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Sheets API**.

> **If you hit `iam.disableServiceAccountKeyCreation`:** that Organization Policy blocks
> downloadable service-account keys tenant-wide — a sensible default that needs a deliberate
> exception here. Someone with **Organization Policy Administrator** must disable the
> constraint for this one project, or allow-list this service account, from
> **IAM & Admin → Organization Policies**.

### 4.3 Service account

**IAM & Admin → Service Accounts → Create Service Account.** Any name. **No project-level IAM
role is needed** — access comes from Shared Drive membership.

### 4.4 Grant access (the step that actually matters)

Back in Drive: open `BFL Cash Forms` → **Manage members** → add the service account's address
(`...@<project>.iam.gserviceaccount.com`) as **Content Manager**.

Creating the service account grants nothing on its own. This is the step that grants access.

### 4.5 Key

Service account → **Keys → Add Key → Create new key → JSON**. Two fields become environment
variables in §6:

| JSON field | Environment variable |
|---|---|
| `client_email` | `GOOGLE_CLIENT_EMAIL` |
| `private_key` | `GOOGLE_PRIVATE_KEY` (one line, literal `\n` sequences preserved) |

**Keep the downloaded file only until §6 is complete. §11-A deletes it.** After §6 the only
copy of that key is `/etc/bfl-cash-form/server.env`.

### 4.6 Folder and ledger IDs

- `GOOGLE_DRIVE_FOLDER_ID` — open the Shared Drive (or a folder inside it) and copy the ID
  from the URL: `drive.google.com/drive/folders/THIS_PART`.
- `GOOGLE_SHEETS_SPREADSHEET_ID` *(optional)* — create the sheet **inside the Shared Drive**
  so membership already covers it, no separate share. ID from
  `docs.google.com/spreadsheets/d/THIS_PART/edit`.
- Name the tab `Transactions` and give it a header row in the exact column order of
  `buildTransactionRow` (`server/src/sheets.js:20-41`):

  Reference · Date/Time · Kind · Branch · Device ID · IP · Account Name · Account Number ·
  Amount · Currency · Amount In Words · Source of Funds · Processed By · Consent ·
  Mail Delivered · Mail Spooled · Archived

That sheet carries the **audit** field set, not the customer-facing one — access to it is as
sensitive as access to the IT inbox (`README.md:204-207`).

---

## §5 · SMTP relay

Use BFL's existing mail system, not a new provider. A **dedicated sending mailbox**
(`no-reply@bfl.la`), never a person's inbox.

### If Microsoft 365

1. An Exchange admin enables **Authenticated SMTP** for that one mailbox
   (Exchange admin center → the mailbox → **Manage email apps**) — per-mailbox, never
   tenant-wide.
2. `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
   `SMTP_USER=no-reply@bfl.la`, `SMTP_PASS=<that mailbox's password or app password>`.

### If Google Workspace

1. Enable 2-Step Verification on the sending account.
2. Generate an app password at
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
   `SMTP_USER=no-reply@bfl.la`, `SMTP_PASS=<the app password>`.

### Either way

**`MAIL_FROM` must equal `SMTP_USER`.** Most providers reject a send whose envelope sender
does not match the authenticated account; Gmail always does (`server/src/config.js:15-17`).

Confirm the VPS can actually reach the relay — some hosting providers block outbound 587 by
default:

```bash
nc -vz smtp.office365.com 587
```

---

## §6 · Secrets — generate, place, permission

### 6.1 Generate the two new secrets

```bash
openssl rand -base64 32
```

Run it twice: once for `DEVICE_KEY` (S1), once for `ADMIN_TOKEN` (S1). Generate them **on the
VPS** and paste straight into the env file — they never need to exist anywhere else, except
`DEVICE_KEY`, which also goes into the web build (6.4).

### 6.2 The one file that holds production secrets

```bash
sudo mkdir -p /etc/bfl-cash-form && sudo nano /etc/bfl-cash-form/server.env
```

Contents (full reference in Appendix A):

```
PORT=8787
ALLOWED_ORIGINS=https://forms.bfl.la

MAIL_TO=it.support@bfl.la
MAIL_FROM=no-reply@bfl.la
SMTP_HOST=<from §5>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<from §5 — must equal MAIL_FROM>
SMTP_PASS=<from §5>
MAIL_RETRY_ATTEMPTS=3
MAIL_RETRY_BASE_MS=400
MAIL_TIMEOUT_MS=15000

GOOGLE_CLIENT_EMAIL=<from §4.5>
GOOGLE_PRIVATE_KEY=<from §4.5 — one line, literal \n sequences and all>
GOOGLE_TIMEOUT_MS=15000
GOOGLE_DRIVE_FOLDER_ID=<from §4.6>

# Optional — omit both lines entirely to skip the ledger
GOOGLE_SHEETS_SPREADSHEET_ID=<from §4.6>
GOOGLE_SHEETS_TAB=Transactions

OUTBOX_DIR=/var/lib/bfl-cash-form/outbox

# New in S1
DEVICE_KEY=<from §6.1>
ADMIN_TOKEN=<from §6.1>
```

### 6.3 Lock it down

```bash
sudo chown root:bflapp /etc/bfl-cash-form/server.env && sudo chmod 640 /etc/bfl-cash-form/server.env
```

Root owns it, the service group reads it, nobody else can open it. It is deliberately
**outside** `/opt/bfl-cash-form`, so it cannot be `git add`-ed by accident and a redeploy
cannot overwrite it.

### 6.4 The web build's variables

Vite inlines these at build time — this is not a runtime secret store. On the server, at
`/opt/bfl-cash-form/web/.env.production`:

```
VITE_API_BASE=https://forms.bfl.la
VITE_DEVICE_KEY=<the same DEVICE_KEY from §6.1>
```

`VITE_DEVICE_KEY` ends up readable inside the JavaScript bundle. That is inherent and
accepted — see the caveat in S1. Rotating it means rebuilding the web app, not just
restarting the service.

### 6.5 Rotation gate — read before reusing any existing value

**Every credential currently in the developer machine's `server/.env` must be regenerated,
not copied into §6.2.** Those values are already exposed on two counts:

1. The repository lives under `C:\Users\souka\OneDrive\Desktop\BFL`, i.e. **`server/.env` has
   been synced to Microsoft OneDrive**, along with its version history.
2. The same values were uploaded to Vercel's environment store for the demo deployment.

Concretely: generate a **new** SMTP password (§5), and use the **new** service-account key
(§4.5) rather than the existing OAuth client secret and refresh token — which §11-D revokes
outright.

---

## §7 · Build and deploy

### 7.1 Install and build

**On Vercel** this is the build command in `vercel.json` and runs automatically:
`npm ci` at the root, then `npm run vercel-build` (preflight, then the web build).

**On the VPS**, the two halves are npm workspaces of one root package, so they install together
from the root rather than separately:

```bash
cd /opt/bfl-cash-form && sudo -u bflapp npm ci && sudo -u bflapp npm run build --workspace web
```

`npm ci` installs strictly from the committed lockfile — the **root** `package-lock.json`, which
is now the only one. `server/package-lock.json` and `web/package-lock.json` were deleted rather
than left in place: npm resolves a workspace member against the root lockfile and ignores a
nested one entirely, so those files would have sat there looking authoritative while describing a
dependency tree nothing installs. Running `npm ci` from inside `server/` or `web/` still works,
but it quietly acts on the whole workspace from the root — prefer the root command above, and
note that `--omit=dev` there would strip `web/`'s build tooling too.

The web build still outputs to `/opt/bfl-cash-form/web/dist`, which is exactly what nginx serves
(§8).

### 7.1b Vercel project — the steps that are not in the repository

`vercel.json`, `api/index.js` and `middleware.js` are committed, so everything below is
account-side setup. Do them in this order; the last step is the only irreversible one.

1. **Delete the two old demo projects first** — §11-D. They are a live, unauthenticated
   exposure and deleting them is not made less urgent by this deployment.
2. `npx vercel login`, then `npx vercel link` from the repository root. Create a **new**
   project; do not reattach to `bfl-cash-form-api` or `bfl-cash-form-web`.
3. **Project Settings → Node.js Version → 22.x or newer.** The root `package.json` declares
   `engines.node: ">=22"`, but Vercel takes the major from this setting.
4. **Storage → connect a Blob store** to the project. `BLOB_READ_WRITE_TOKEN` is then injected
   automatically; the build fails without it whenever `SPOOL_DRIVER=blob`.
5. **Environment variables** — everything from §6.2, plus the four in the table below. Scope
   the SMTP and Google values to **Production _and_ Build**: the build-time preflight cannot
   verify credentials it cannot read, and it is the only thing standing between a rejected
   credential and a live deployment.

   | Variable | Value | Consequence of getting it wrong |
   |---|---|---|
   | `TRUST_PROXY` | `1` | At `0`, every audit mail, ledger row and PDF records Vercel's proxy instead of the tablet, and per-IP rate limiting becomes one shared bucket |
   | `SPOOL_DRIVER` | `blob` | At `fs`, an undeliverable form is written to a filesystem that is discarded when the container recycles — silently, with the customer already gone |
   | `ALLOWED_CIDRS` | branch + VPN egress | Unset denies all `/api/`; set too wide, and the device key inlined in the public bundle is the only thing left (§9.1) |
   | `ADMIN_CIDRS` | IT administration range | Guards `/api/spool*`, which lists real customers' queued submissions |

   `VITE_API_BASE` and `VITE_API_KEY` are build-time only and end up inside the bundle. Set
   `VITE_API_BASE` and `ALLOWED_ORIGINS` to the same production URL — §3.4's one origin.

6. **Rotate before you paste.** §6.5 applies unchanged: the values currently in `server/.env`
   were exposed through OneDrive version history and the earlier public demo deployment. Rotate
   the SMTP password and the Google credentials rather than reusing them.
7. `npx vercel --prod`. Watch the build log for the `preflight OK` block — a `FATAL:` block
   there means the deploy correctly refused, and §7.3's guidance applies.

Then §10 in full. The Vercel-specific checks are collected in Appendix D.

### 7.2 systemd unit

`/etc/systemd/system/bfl-cash-form.service`:

```ini
[Unit]
Description=BFL cash deposit/withdrawal submission service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bflapp
Group=bflapp
WorkingDirectory=/opt/bfl-cash-form/server
EnvironmentFile=/etc/bfl-cash-form/server.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

# Sandboxing
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ReadWritePaths=/var/lib/bfl-cash-form
RestrictAddressFamilies=AF_INET AF_INET6
RestrictNamespaces=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallFilter=@system-service
SystemCallArchitectures=native
CapabilityBoundingSet=
UMask=0077

[Install]
WantedBy=multi-user.target
```

`ExecStart` calls `src/index.js` directly rather than `npm start`, so the environment comes
only from `EnvironmentFile` and never from a stray `.env` in the working directory.

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now bfl-cash-form && sudo systemctl status bfl-cash-form
```

### 7.3 Confirm a clean boot

```bash
sudo journalctl -u bfl-cash-form -n 30 --no-pager
```

Expect all three channels verified:

```
mail    -> smtp (verified)
archive -> Google Drive (verified)
sheets  -> ok
```

A `FATAL:` block instead means the service **correctly refused to start** on bad
configuration (`server/src/preflight.js`). Fix what the message names and restart; do not work
around it. On Vercel the same block appears in the **build log** rather than at boot, and fails
the deploy — see §0 and `server/scripts/preflight-cli.mjs`.

---

## §8 · nginx — TLS, headers, limits

Full config in Appendix B. What matters and why:

- **TLS 1.2 and 1.3 only**, Mozilla intermediate cipher list. `server_tokens off`.
- **`client_max_body_size 6m`** — deliberately just above S4's 5 MB multer limit, so
  oversized uploads are rejected at the edge rather than buffered by Node.
- **SPA routing** — `try_files $uri /index.html` from `web/dist`.
- **API proxy** to `127.0.0.1:8787` setting `X-Forwarded-For` and `X-Forwarded-Proto`. This
  pairs with S6's `trust proxy 1`: nginx appends the real socket address, Express reads the
  last hop, and a client-supplied header can no longer forge the recorded IP.

### Response headers

| Header | Value | Note |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | **Warning:** `includeSubDomains` commits the entire `bfl.la` zone to HTTPS for two years. Drop it if any other host on `bfl.la` is not HTTPS-ready. Do not add `preload` without a deliberate decision — it is effectively irreversible. |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `no-referrer` | Reference numbers must not leak in `Referer` headers |
| `X-Frame-Options` | `DENY` | Plus `frame-ancestors 'none'` in the CSP |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=()` | **`camera=(self)` is required** — the photo step uses `getUserMedia`. Removing it breaks the flow. |

### Content-Security-Policy

Verified against the actual build (`web/dist/index.html` contains **no inline scripts** —
Vite emits external module scripts only):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://bfl-bred.com;
font-src 'self';
connect-src 'self' data: https://bfl-bred.com;
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

Each non-obvious allowance, and how to remove it:

- `style-src 'unsafe-inline'` — required by one inline style attribute at
  `web/src/components/AccountNumberInput.tsx:82`. Never extend `'unsafe-inline'` to
  `script-src`.
- `img-src data: blob:` — the captured photo and signature are data URLs
  (`web/src/screens/PhotoScreen.tsx:65`, `SignatureScreen.tsx:88`) and downloads use blob URLs
  (`web/src/lib/submit.ts:87`).
- `connect-src data:` — needed only by `web/src/lib/submit.ts:68-69`, which `fetch()`es those
  data URLs. **S5 deletes those lines, after which `data:` can be dropped from `connect-src`.**
- `https://bfl-bred.com` in both `img-src` and `connect-src` — `web/src/components/Logo.tsx:9`
  loads the logo from the public website, both as an `<img>` and via `fetch()` for embedding
  into the PDF (`Logo.tsx:15-22`).

  **Recommended:** drop the remote fetch and rely on the bundled
  `web/public/logo-bfl.png` fallback that already exists. Branch tablets then make **no
  third-party request at all**, and the CSP tightens to `img-src 'self' data: blob:` /
  `connect-src 'self'`. The remote URL only exists to pick up a logo change without a
  redeploy — a poor trade for a bank tablet on a restricted network.

---

## §9 · Network restriction and rate limiting

This is the strongest of the four access-control layers, and the one that makes the device
key's visibility in the bundle tolerable.

### 9.1 Source-IP allowlist

In nginx (Appendix B), restrict `/api/` to branch and VPN egress ranges, and restrict
`/api/spool*` further to the IT administration range:

```nginx
location /api/ {
  allow <BRANCH_CIDR>;
  allow <IT_ADMIN_CIDR>;
  deny  all;
  # ... proxy directives
}

location /api/spool {
  allow <IT_ADMIN_CIDR>;
  deny  all;
  # ... proxy directives
}
```

Collect the real egress addresses from BFL's network team — one per branch site, plus the
VPN concentrator. Note that `/` (the static app) stays open: the tablet UI is not sensitive,
and locking it down would break nothing but would also protect nothing.

**If branch egress IPs are dynamic** — do not silently fall back to device-key-only. Pick
one:

- a site-to-site VPN so tablets present a stable source address, or
- an identity-aware proxy in front (Cloudflare Access or equivalent) enforcing device
  certificates, or
- client-certificate (mTLS) authentication in nginx, provisioned per tablet.

Whichever is chosen, record the decision and its date here.

### 9.2 Rate limiting at the edge

```nginx
limit_req_zone $binary_remote_addr zone=submit:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=admin:10m  rate=5r/m;
```

`limit_req zone=submit burst=5 nodelay;` on `/api/submissions`, `zone=admin burst=2` on
`/api/spool*`. This is in addition to S9's in-process limiter — the edge limit protects Node
from ever seeing the traffic; the in-process one survives a proxy misconfiguration.

---

## §10 · Verification

Nothing is "deployed" until every check below passes. Record the results.

### 10.1 Functional — one real end-to-end submission

Complete the form from a branch tablet as a customer would, with plausible placeholder
details, and request a customer copy to a mailbox you control. Then confirm:

1. The **audit email** arrives at `it.support@bfl.la`, carrying every field plus branch,
   Device ID, IP and the consent line.
2. The **PDF** appears in the `BFL Cash Forms` Shared Drive.
3. A **ledger row** appears in the `Transactions` tab (if configured).
4. The **customer copy** arrives — and contains **no Device ID, no IP address and no consent
   line**. This is the guarantee S10 re-pins in code; check it by eye here too.
5. The customer copy passes SPF, DKIM and DMARC (§3.3) in its `Authentication-Results` header.

```bash
curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" https://forms.bfl.la/api/health/detail
```

`spoolDepth` must be `0`.

### 10.2 Security — each with its expected result

| Check | Command | Expected |
|---|---|---|
| Device key enforced | `curl -X POST https://forms.bfl.la/api/submissions` | `401` |
| Admin token enforced | `curl https://forms.bfl.la/api/spool` | `401` |
| Public health is minimal | `curl https://forms.bfl.la/api/health` | exactly `{"ok":true}` |
| Allowlist enforced | same calls from an address outside `<BRANCH_CIDR>` | `403` |
| Traversal rejected (S2) | `POST` with `meta.referenceNo` = `../../../../tmp/pwn` | `400`, and `sudo find / -name 'pwn*' -newermt '-5 min'` is empty |
| Non-PDF rejected (S4) | `POST` a text file as the `pdf` part | `400` |
| Oversize rejected | `POST` a 10 MB file | `413` at nginx |
| Rate limit works | 30 rapid submissions | `429` |
| IP not spoofable (S6) | `POST` with `X-Forwarded-For: 1.2.3.4` | the audit email shows the **real** address |
| Errors are opaque (S7) | force a Drive failure | response has no Google API text |
| Headers present | `curl -I https://forms.bfl.la` | HSTS, CSP, `nosniff`, `Referrer-Policy` all present |
| TLS grade | SSL Labs on `forms.bfl.la` | **A** or better |
| No stray env file | `sudo ls -la /opt/bfl-cash-form/server/.env` | "No such file" |
| Tests green (S10) | `npm test` in `server/` and `web/` | pass |
| Dependencies clean (S12) | `npm audit --omit=dev` | no unaccepted findings |

### 10.3 Camera

On a real tablet over HTTPS, confirm the photo step opens the camera. If it reports the
camera unavailable, check `Permissions-Policy` in §8 — `camera=(self)` must be present.

---

## §11 · Post-deployment removal and rotation

The step this whole document builds toward. **Order matters: rotate first, then delete.**
Deleting a file does not un-expose the credential that was in it.

Do this only once §10 passes **from the server**.

### A · Developer machine — `C:\Users\souka\OneDrive\Desktop\BFL`

Rotate first (§6.5), then delete:

- [ ] `server/.env` — holds the live SMTP password, Google OAuth client secret and refresh
      token, Drive folder and Sheets IDs. **Rotate every value before deleting.**
- [ ] `server/.env.local` and `server/.env.demo`
- [ ] `web/.env.local` — holds `VITE_API_BASE` **and** a `VERCEL_OIDC_TOKEN`
- [ ] `.env.local` at the repo root — holds a `VERCEL_OIDC_TOKEN`
- [ ] `.vercel/` and `web/.vercel/` — project and organisation IDs for the two **demo** projects.
      Delete these before linking the new project, so `vercel link` cannot silently reattach to a
      decommissioned one. (`.vercel/` is gitignored and holds no secret, but the OIDC tokens
      above are separate and must still be revoked.)
- [ ] `web/dist/` — a stale build carrying the old `VITE_API_BASE`; production rebuilds on
      the server (§7.1)
- [ ] The service-account JSON key downloaded in §4.5 (check `~/Downloads`)
- [ ] Shell history lines containing any secret — `history -c`, or edit
      `~/.bash_history` / `~/.zsh_history` / the PowerShell `ConsoleHost_history.txt`

```bash
rm -f server/.env server/.env.local server/.env.demo web/.env.local .env.local && rm -rf .vercel web/.vercel web/dist
```

**OneDrive — do not stop at local deletion.** This repository path is synced to Microsoft
OneDrive, so every file above also exists in the cloud, *including previous versions*.

- [ ] Empty the OneDrive **Recycle bin** (and the second-stage recycle bin) for these files
- [ ] Purge their **version history** in OneDrive
- [ ] Treat every value they held as exposed to the OneDrive tenant — which is half the
      reason for §6.5's rotation gate
- [ ] Going forward, keep working copies of this repository **outside** any synced folder

**Git history is clean — verified, and re-verifiable:**

```bash
git log --all --full-history --oneline -- "*.env" "*.env.local" "*.env.demo" ".vercel/*"
```

Empty output means no environment file was ever committed. The only secret-shaped strings in
history are placeholders in `prod_setup.md` (`SMTP_PASS=<from §5>`). Because of that, **no
history rewrite is needed** — but if a real secret is ever committed in future, rotating it
comes first and rewriting history second, never the reverse.

### B · Repository — the superseded docs

**Superseded 2026-08-23 for the first two items.** Vercel is now the production target (§0), so
`api/index.js` and `vercel.json` are live deployment configuration and must **not** be deleted.
The concern that motivated deleting them — an entry point that boots with rejected credentials —
is instead closed by the build-time preflight; see §0 and `server/scripts/preflight-cli.mjs`.

Still to remove:

- [ ] **`server/scripts/google-oauth-setup.mjs`** — exists solely to mint the personal OAuth
      refresh token and to write it into `server/.env`. Obsolete once §4's service account is
      live, and it is a tool whose whole job is writing a secret to disk. Delete it, and drop
      the `google:auth` script from `server/package.json`.
- [ ] **`prod_setup.md`** — superseded by this file, and its §4 contradicts `README.md` on
      how Google auth works.

Then reconcile the docs so they describe what is actually deployed:

- [ ] `README.md` "Setting up Google access" still describes the personal OAuth flow — rewrite
      it for the service account (§4), or point it here.
- [ ] `README.md:107` claims `messages.test.js` enforces the customer-copy PII guarantee —
      true again only once S10 is done.
- [ ] `server/.env.example` — replace the `GOOGLE_OAUTH_*` block with `GOOGLE_CLIENT_EMAIL` /
      `GOOGLE_PRIVATE_KEY`, and add `DEVICE_KEY` and `ADMIN_TOKEN`.
- [ ] `web/.env.example` — add `VITE_DEVICE_KEY`.

**Keep:** `server/src/index.js`, both `.env.example` files, and both `.gitignore` files
exactly as they are.

### C · Production server

- [ ] Confirm `/opt/bfl-cash-form/server/.env` **does not exist** — the environment comes only
      from `/etc/bfl-cash-form/server.env`
- [ ] Confirm `640 root:bflapp` on `/etc/bfl-cash-form/server.env`
- [ ] Confirm `700 bflapp:bflapp` on `/var/lib/bfl-cash-form/outbox`
- [ ] Confirm nginx's `root` is `/opt/bfl-cash-form/web/dist`, so the checkout's `.git` can
      never be served
- [ ] Keep the checkout at `750 bflapp:bflapp`
- [ ] Schedule the `outbox/sent/` retention purge (§12) — those directories contain complete
      customer payloads

```bash
sudo ls -la /opt/bfl-cash-form/server/.env /etc/bfl-cash-form/server.env /var/lib/bfl-cash-form/outbox
```

### D · External services — the old attack surface stays live until these are done

- [ ] **Vercel — delete the two old demo projects.** `bfl-cash-form-api` (`prj_J8Zx…`) and
      `bfl-cash-form-web` (`prj_Qtb3…`), organisation `team_2nqcHzjL…`. Remove every
      environment variable first, then delete the projects, then revoke the OIDC tokens.

      Until this is done, **a publicly reachable, entirely unauthenticated copy of this API is
      running with live bank credentials at a `*.vercel.app` URL.** Every defect in §1 is
      exploitable there today, against the real mailbox and the real Drive. This is the single
      highest-priority item in this document — it can be done immediately, before any of the
      rest.

      **This is unchanged by the 2026-08-23 move to Vercel.** Those two projects predate every
      fix in §1: they have no authentication, no allowlist, no durable spool and no build-time
      preflight. The new single project replaces both and does not inherit anything from them.
      Delete them *before* deploying the new one, not after — they are a live exposure, and
      having a supported deployment next door does not make them less so.
- [ ] **Google — revoke the personal OAuth grant** at
      [myaccount.google.com/permissions](https://myaccount.google.com/permissions), and delete
      the Desktop OAuth client from Cloud Console. §4's service account replaces it entirely.
- [ ] **SMTP — rotate** the sending mailbox's password or app password (§6.5), and update
      `/etc/bfl-cash-form/server.env` followed by `sudo systemctl restart bfl-cash-form`.
- [ ] **GitHub** — if a personal access token or a non-deploy key was used for §2.8, revoke it
      and replace it with a read-only deploy key.

### E · Sign-off

Record who completed A–D, and on what date, alongside the §10 results. If there is ever doubt
that a secret stayed private — it was screen-shared, pasted somewhere it should not have been,
included in a screenshot — **rotate it rather than hoping**. Every credential here is a
drop-in replacement in one file followed by one restart.

---

## §12 · Ongoing operations

- **Spool depth is the thing to alert on.** `GET /api/health/detail` reports `spoolDepth`; it
  should stay `0`. Nonzero means mail delivery is failing and forms are being queued rather
  than lost. Drain it once the relay is fixed:

  ```bash
  curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://forms.bfl.la/api/spool/flush
  ```

  Delivered items move to `outbox/sent/` rather than being deleted, so an operator can see
  what went out after an outage.
- **Retention.** `outbox/sent/` accumulates complete customer payloads and PDFs. Set a purge
  schedule matching BFL's data-retention policy — the Drive archive is the record of truth,
  not the spool.
- **Logs.** `journalctl -u bfl-cash-form`. Adjust retention in `/etc/systemd/journald.conf` to
  match policy. Note that logs contain reference numbers (`app.js:88,94`, `drive.js:50`,
  `mailer.js:83`) — treat them as customer-linked records.
- **TLS renewal.** Certbot's timer handles it: `systemctl list-timers | grep certbot`.
- **Credential rotation.** On BFL's policy schedule, rotate the service-account key and the
  SMTP password; both are drop-in replacements in `/etc/bfl-cash-form/server.env` followed by
  `sudo systemctl restart bfl-cash-form`. Rotating `DEVICE_KEY` additionally requires a web
  rebuild (§6.4) and redeployment to the tablets.
- **Updates.** `git pull`, re-run §7.1, `sudo systemctl restart bfl-cash-form`. Nothing in that
  flow touches `/etc/bfl-cash-form/server.env` or `/var/lib/bfl-cash-form`, so updates can
  never destroy production credentials or queued forms.
- **Dependency review.** `npm audit --omit=dev` quarterly, and after every dependency change.
- **Branch list.** `BRANCHES` in `web/src/lib/device.ts:8-18` is hardcoded; adding a branch
  means a rebuild and redeploy.
- **Lao wording.** `README.md:93-95` flags that the Lao strings in
  `web/src/i18n/dictionary.ts` and `web/src/lib/amountInWords.ts` need native-speaker review
  before go-live. Both are printed on the customer's PDF.

---

## Appendix A · Environment variable reference

`/etc/bfl-cash-form/server.env` — read by systemd, `640 root:bflapp`.

| Variable | Value / source | Required | Notes |
|---|---|---|---|
| `PORT` | `8787` | yes | Loopback only; nginx proxies to it |
| `ALLOWED_ORIGINS` | `https://forms.bfl.la` | yes | Browser-side control only, not access control |
| `MAIL_TO` | `it.support@bfl.la` | yes | Every completed form goes here |
| `MAIL_FROM` | `no-reply@bfl.la` | yes | **Must equal `SMTP_USER`** |
| `SMTP_HOST` | §5 | yes | Service refuses to boot without it |
| `SMTP_PORT` | `587` | yes | |
| `SMTP_SECURE` | `false` | yes | `false` = STARTTLS on 587; `true` only for implicit TLS on 465 |
| `SMTP_USER` | §5 | yes | |
| `SMTP_PASS` | §5 | yes | Rotate per §6.5 |
| `MAIL_RETRY_ATTEMPTS` | `3` | no | |
| `MAIL_RETRY_BASE_MS` | `400` | no | Exponential backoff with jitter |
| `MAIL_TIMEOUT_MS` | `15000` | no | Connection, greeting and socket timeout |
| `GOOGLE_CLIENT_EMAIL` | §4.5 | yes | After the §4.0 code change |
| `GOOGLE_PRIVATE_KEY` | §4.5 | yes | One line, literal `\n` preserved |
| `GOOGLE_TIMEOUT_MS` | `15000` | no | |
| `GOOGLE_DRIVE_FOLDER_ID` | §4.6 | yes | Shared Drive folder; boot fails if unreachable |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | §4.6 | no | Omit to skip the ledger entirely |
| `GOOGLE_SHEETS_TAB` | `Transactions` | no | Defaults to `Transactions` |
| `OUTBOX_DIR` | `/var/lib/bfl-cash-form/outbox` | yes | Contains customer PII; `700` |
| `DEVICE_KEY` | §6.1 | yes | New in S1; also built into the web bundle |
| `ADMIN_TOKEN` | §6.1 | yes | New in S1; server-side only, never in the bundle |

`/opt/bfl-cash-form/web/.env.production` — build-time only:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | `https://forms.bfl.la` |
| `VITE_DEVICE_KEY` | the same `DEVICE_KEY` |

---

## Appendix B · nginx site configuration

`/etc/nginx/sites-available/bfl-cash-form`. Add the two `limit_req_zone` lines to the `http`
block in `/etc/nginx/nginx.conf`, not here. Certbot adds the TLS block and the port-80
redirect when it runs (§3.2).

```nginx
# --- in /etc/nginx/nginx.conf, http { } block ---
# limit_req_zone $binary_remote_addr zone=submit:10m rate=20r/m;
# limit_req_zone $binary_remote_addr zone=admin:10m  rate=5r/m;
# server_tokens off;

server {
    listen 80;
    server_name forms.bfl.la;

    root /opt/bfl-cash-form/web/dist;
    index index.html;

    client_max_body_size 6m;

    # Security headers — see §8 for why each one is here
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "no-referrer" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Permissions-Policy        "camera=(self), microphone=(), geolocation=(), payment=()" always;
    add_header Content-Security-Policy   "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://bfl-bred.com; font-src 'self'; connect-src 'self' data: https://bfl-bred.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;

    # The tablet app — open, it is not sensitive
    location / {
        try_files $uri /index.html;
    }

    # Operations routes: IT administration range only
    location /api/spool {
        allow <IT_ADMIN_CIDR>;
        deny  all;

        limit_req zone=admin burst=2;

        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Submissions and the rest of the API: branch and VPN ranges only
    location /api/ {
        allow <BRANCH_CIDR>;
        allow <IT_ADMIN_CIDR>;
        deny  all;

        limit_req zone=submit burst=5 nodelay;

        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bfl-cash-form /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

Remove the default site so `forms.bfl.la` is not served by a catch-all:

```bash
sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx
```

> `add_header` directives do not inherit into a `location` block that declares its own. The
> config above keeps all `add_header` lines at `server` level and none inside the `location`
> blocks, so they apply everywhere. If you ever add one inside a `location`, you must repeat
> the whole set there.

---

## Appendix C · systemd unit

See §7.2 for the full unit file. Verify the sandboxing actually applied:

```bash
systemd-analyze security bfl-cash-form
```

Aim for an exposure score under 3.0. Anything materially worse means a directive was dropped
or is being overridden.

---

## Appendix D · Go / no-go checklist

Do not open the service to branch tablets until every line is ticked.

**Code (§1)**

- [ ] S1 — device key and admin token enforced; public health reduced to `{"ok":true}`
- [ ] S2 — reference validated against `/^BFL\d{14}[0-9A-F]{6}$/`; filename derived server-side
- [ ] S3 — no `originalname` reaching Drive or the mail attachment
- [ ] S4 — `%PDF-` magic bytes asserted; limit reduced to 5 MB
- [ ] S5 — photo and signature no longer uploaded or accepted
- [ ] S6 — `trust proxy` set to `1`
- [ ] S7 — generic 500 responses with a correlation id
- [ ] S8 — multer limits set and payload validated
- [ ] S9 — rate limiting and helmet in place
- [ ] S10 — test suite restored and green, including the customer-copy PII test
- [ ] S11 — `engines` pinned to Node ≥ 22
- [ ] S12 — `npm audit` clean in both packages

**Infrastructure (§2–§9)**

- [ ] VPS hardened: key-only SSH, ufw, unattended-upgrades, fail2ban, non-root service user
- [ ] `forms.bfl.la` resolves; CAA record set; certificate issued and auto-renewing
- [ ] SPF, DKIM and DMARC pass for `no-reply@bfl.la`
- [ ] Service account created, added to the Shared Drive as Content Manager, §4.0 code change merged
- [ ] SMTP relay reachable from the VPS; `MAIL_FROM` equals `SMTP_USER`
- [ ] `/etc/bfl-cash-form/server.env` populated with **rotated** values, `640 root:bflapp`
- [ ] systemd unit active, sandboxed, clean boot with all three channels verified
- [ ] nginx serving `web/dist`, all security headers present, CSP verified in a browser console
- [ ] IP allowlist enforced on `/api/`, tighter on `/api/spool*`; rate limits active

**Verification (§10)**

- [ ] One real end-to-end submission: audit email, Drive PDF, ledger row, `spoolDepth: 0`
- [ ] Customer copy contains no Device ID, IP or consent line
- [ ] Every row of the §10.2 security table returns its expected status
- [ ] Camera works on a real tablet over HTTPS
- [ ] SSL Labs grade A or better

**Vercel-specific (§0)** — none of these have a VPS equivalent, so none are covered above:

- [ ] `TRUST_PROXY=1` — a forged `X-Forwarded-For` does **not** reach the audit mail or ledger
- [ ] `SPOOL_DRIVER=blob` and a Blob store connected — force a mail failure, redeploy, and
      confirm the spooled form is **still** listed by `GET /api/spool` afterwards
- [ ] `ALLOWED_CIDRS` and `ADMIN_CIDRS` set — `/api/` from an outside address returns `403`
- [ ] A deploy with a deliberately wrong `SMTP_PASS` **fails the build**
- [ ] A real submission fits inside the 4.5 MB request limit

**Cleanup (§11)**

- [ ] A — developer machine wiped, OneDrive recycle bin and version history purged
- [ ] B — OAuth setup script and `prod_setup.md` deleted; docs reconciled. (`api/index.js` and
      `vercel.json` are live configuration as of 2026-08-23 — **do not** delete them)
- [ ] C — server verified: no stray `.env`, correct permissions, retention scheduled
- [ ] D — **both old demo Vercel projects deleted**, personal Google OAuth grant revoked, SMTP
      password rotated
- [ ] E — sign-off recorded with names and dates
