# Production setup — BFL Cash Deposit / Withdrawal Form

This is a runbook for taking the app from "runs on someone's laptop" to "hosted, real BFL
infrastructure." It is written to be followed once, by whoever at BFL has hosting, DNS, Google
Workspace and mail-system access — most of these steps use accounts and infrastructure I can't
touch, so this document describes what to do rather than doing it.

## Before you start

**This file never contains a real secret.** Every credential this guide produces is written as
a placeholder like `<value from step 4>`. The real value goes straight into the production
environment file on the server (§6) — never into this document, never into a commit, never
left sitting in a chat log or a screenshot.

**One prerequisite code change, not yet made.** Today the app only knows how to authenticate to
Google via a personal OAuth authorization (`server/src/google.js`, `npm run google:auth`) — the
right choice for development, wrong for a bank's production system, since it ties production
access to one person's Google session. This guide's Google section (§4) sets up the
production-correct alternative instead: a **service account** with its own identity, holding
files in a **Shared Drive** rather than any individual's storage. Before §4's credentials will
actually work, `server/src/google.js` needs a small change to accept a service-account
credential (`GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`) alongside the OAuth one it already
supports, choosing whichever is present. That change is a couple dozen lines and is tracked
separately — do not start §4 assuming it's already there; confirm with whoever maintains the
code first.

**What's being hosted:** the `server/` Node service (Express — handles submissions, sends
mail, archives PDFs, logs the ledger) and the `web/` static build (React/Vite — the tablet UI).
Three external dependencies: an SMTP relay, Google Drive (required), Google Sheets (optional).

---

## 1. Provision the server

A small VPS is plenty — this is a low-traffic internal tool, not a public service. The
smallest tier from any mainstream provider (1 vCPU, 1–2 GB RAM) is enough headroom.

1. Create the VPS. Ubuntu 22.04 or 24.04 LTS is assumed below; adjust package manager commands
   if BFL standardizes on something else.
2. **Harden it before anything else is installed:**
   ```bash
   # SSH key auth only — disable password login
   sudo passwd -l root
   # in /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
   sudo systemctl restart sshd

   # Firewall: only SSH, HTTP, HTTPS
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
3. **Create a dedicated, non-root user to run the app** — never run a Node process as root:
   ```bash
   sudo adduser --system --group --home /opt/bfl-cash-form bflapp
   ```
4. **Install Node.** The code uses `--env-file-if-exists`, which needs **Node 20.6 or newer**;
   Node 22 LTS is the safer target:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version   # confirm >= 20.6
   ```
5. **Install nginx and certbot** (used in §3):
   ```bash
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   ```

---

## 2. Get the code onto the server

```bash
sudo mkdir -p /opt/bfl-cash-form
sudo chown bflapp:bflapp /opt/bfl-cash-form
sudo -u bflapp git clone https://github.com/Akomder/BFL_Bred_Group.git /opt/bfl-cash-form
```

If the repository is private, set up a deploy key (GitHub → repo → Settings → Deploy keys) with
read-only access, rather than a personal account's credentials — a deploy key can be scoped to
this one repo and revoked independently of anyone's account.

---

## 3. DNS and HTTPS

The camera step needs a secure context — the README already flags this. `localhost` satisfies
it for development; production needs a real HTTPS domain.

1. **Pick the subdomain** — e.g. `cashform.bfl-bred.com`. In BFL's DNS provider, add an `A`
   record pointing it at the VPS's public IP address. (If the VPS provider gives an IPv6
   address too, add an `AAAA` record as well.)
2. **Wait for DNS to propagate** — `dig cashform.bfl-bred.com` from your own machine should
   return the VPS's IP before continuing.
3. **nginx site config** — `/etc/nginx/sites-available/bfl-cash-form`:
   ```nginx
   server {
     listen 80;
     server_name cashform.bfl-bred.com;

     # Static web build
     root /opt/bfl-cash-form/web/dist;
     index index.html;
     location / {
       try_files $uri /index.html;
     }

     # API — proxied to the Node service (§7)
     location /api/ {
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/bfl-cash-form /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **Obtain the certificate** — certbot edits the nginx config above in place to add the HTTPS
   server block and redirect:
   ```bash
   sudo certbot --nginx -d cashform.bfl-bred.com
   ```
   Certbot installs a systemd timer that renews automatically; nothing further to do here.

Same-domain, path-based routing like this means the web app and the API share one origin —
`VITE_API_BASE` in §6 is just `https://cashform.bfl-bred.com`, and there's no CORS
configuration to get wrong.

---

## 4. Google Workspace — service account + Shared Drive

*Depends on the code change noted at the top of this document.* One service account backs both
the required PDF archive (Drive) and the optional transaction ledger (Sheets).

1. **Create the Shared Drive.** In [drive.google.com](https://drive.google.com) (signed in as
   a BFL Workspace admin or a user with Shared Drive creation rights): **Shared Drives → New**
   — name it something like `BFL Cash Forms`. Shared Drives have their own storage, independent
   of any one person's quota — this is exactly what a personal-account service account lacked
   and why archiving failed during development.
2. **Create the Cloud project.** In [console.cloud.google.com](https://console.cloud.google.com),
   under BFL's Workspace: create a new project (e.g. `bfl-cash-form-prod`).
   > **If you hit `iam.disableServiceAccountKeyCreation`:** this Organization Policy blocks
   > downloadable service-account keys tenant-wide — a sensible default, but it needs a
   > deliberate exception here. A user with the **Organization Policy Administrator** role must
   > either disable the constraint for this one project, or add this service account to an
   > allow-list, from **IAM & Admin → Organization Policies** in Cloud Console.
3. **Enable the APIs** — **APIs & Services → Library** → enable **Google Drive API** and
   **Google Sheets API**.
4. **Create the service account** — **IAM & Admin → Service Accounts → Create Service
   Account**. Any name; no project-level IAM role is needed, since access is granted through
   Shared Drive membership instead (next step).
5. **Add it to the Shared Drive** — back in Drive, open the Shared Drive → **Manage members** →
   add the service account's email (`...@<project>.iam.gserviceaccount.com`) as **Content
   Manager**. This is the step that actually grants access; creating the service account alone
   grants nothing.
6. **Generate the key** — service account → **Keys → Add Key → Create new key → JSON**.
   Downloads a file. Two fields from it become environment variables in §6:
   - `client_email` → `GOOGLE_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
7. **Get the Shared Drive's folder ID** for `GOOGLE_DRIVE_FOLDER_ID` — open the Shared Drive in
   the browser, copy the ID from the URL (`drive.google.com/drive/folders/THIS_PART`).
8. **Optional — the ledger:** create a Google Sheet inside the same Shared Drive (so the
   service account already has access via its Shared Drive membership — no separate sharing
   step). Add a header row matching `buildTransactionRow`'s column order in
   `server/src/sheets.js` (Reference, Date/Time, Kind, Branch, Device ID, IP, Account Name,
   Account Number, Amount, Currency, Amount In Words, Source of Funds, Processed By, Consent,
   Mail Delivered, Mail Spooled, Archived), and rename the tab to `Transactions`. The
   spreadsheet ID from its URL becomes `GOOGLE_SHEETS_SPREADSHEET_ID`.

Keep the downloaded JSON key until §6 is done — then it gets deleted per §9.

---

## 5. Mail relay

BFL's existing mail system, not a new provider. Pick whichever BFL actually runs:

### If Microsoft 365

Most tenants disable basic SMTP AUTH by default (a good default). For this app to send:
1. Have a Microsoft 365 admin enable **SMTP AUTH** for the specific sending mailbox (Exchange
   admin center → the mailbox → **Manage email apps** → enable "Authenticated SMTP"), rather
   than tenant-wide.
2. Use a dedicated mailbox for sending (e.g. `no-reply@bfl.la`), not a real person's inbox.
3. Values for §6: `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
   `SMTP_USER` = that mailbox's address, `SMTP_PASS` = its password (or an app password, if
   the tenant has Modern Auth / MFA enforced and Basic Auth for SMTP specifically re-enabled
   per above).

### If Google Workspace

1. In the sending account (e.g. `no-reply@bfl.la`), turn on **2-Step Verification**
   ([myaccount.google.com/security](https://myaccount.google.com/security)).
2. Generate an app password: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Values for §6: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`
   = the sending address, `SMTP_PASS` = the app password.

Either way: `MAIL_FROM` must equal `SMTP_USER` — mismatched envelope senders get rejected by
most providers, Gmail always.

---

## 6. Populate the production environment

Real values live in **one place**: a root-owned file the deployed process reads at startup —
never a `.env` file sitting in the git working directory, which is too easy to `git add` by
accident.

```bash
sudo mkdir -p /etc/bfl-cash-form
sudo nano /etc/bfl-cash-form/server.env
```

```bash
PORT=8787
ALLOWED_ORIGINS=https://cashform.bfl-bred.com

MAIL_TO=it.support@bfl.la
MAIL_FROM=<the sending mailbox from §5>
SMTP_HOST=<from §5>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<from §5>
SMTP_PASS=<from §5>
MAIL_RETRY_ATTEMPTS=3
MAIL_RETRY_BASE_MS=400
MAIL_TIMEOUT_MS=15000

GOOGLE_CLIENT_EMAIL=<from §4 step 6>
GOOGLE_PRIVATE_KEY=<from §4 step 6 — paste as one line, literal \n sequences and all>
GOOGLE_TIMEOUT_MS=15000
GOOGLE_DRIVE_FOLDER_ID=<from §4 step 7>

# Optional — omit both lines entirely to skip the ledger
GOOGLE_SHEETS_SPREADSHEET_ID=<from §4 step 8>
GOOGLE_SHEETS_TAB=Transactions

OUTBOX_DIR=/opt/bfl-cash-form/server/outbox
```

Lock it down — only the app's own user (via systemd, §7) should ever read this file:

```bash
sudo chown root:bflapp /etc/bfl-cash-form/server.env
sudo chmod 640 /etc/bfl-cash-form/server.env
```

And for the web build (§7), a build-time file — this one is not a runtime secret, but it's
still not committed:

```bash
# /opt/bfl-cash-form/web/.env.production
VITE_API_BASE=https://cashform.bfl-bred.com
```

---

## 7. Deploy

**Server dependencies:**
```bash
cd /opt/bfl-cash-form/server
sudo -u bflapp npm ci --omit=dev
```

**Web build:**
```bash
cd /opt/bfl-cash-form/web
sudo -u bflapp npm ci
sudo -u bflapp npm run build
# outputs to web/dist — this is exactly what nginx serves per §3
```

**systemd unit** — `/etc/systemd/system/bfl-cash-form.service`:
```ini
[Unit]
Description=BFL Cash Deposit/Withdrawal form service
After=network.target

[Service]
Type=simple
User=bflapp
Group=bflapp
WorkingDirectory=/opt/bfl-cash-form/server
EnvironmentFile=/etc/bfl-cash-form/server.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bfl-cash-form
sudo systemctl status bfl-cash-form
```

**Confirm a clean boot** — check the log for all three channels coming up verified:
```bash
sudo journalctl -u bfl-cash-form -n 30 --no-pager
```
Expect:
```
mail    -> smtp (verified)
archive -> Google Drive (verified)
sheets  -> ok
```
If instead you see a `FATAL:` block, the service refuses to start and `systemctl status` will
show it as failed — that's intentional (see the README's "Startup checks"); fix whatever the
message names and restart.

---

## 8. Verify against real BFL infrastructure

One real submission through `https://cashform.bfl-bred.com`, then confirm all three channels
actually delivered, not just that boot succeeded:

1. Complete the form as a customer would (any placeholder-but-plausible details), submit.
2. Confirm the **audit email** arrives at `it.support@bfl.la`.
3. Confirm the **PDF** appears in the BFL Cash Forms Shared Drive.
4. If the ledger is configured, confirm a **row** appears in the sheet.
5. `curl https://cashform.bfl-bred.com/api/health` — should report `spoolDepth: 0` and all
   channels active.

If anything fails, check `sudo journalctl -u bfl-cash-form -f` for the specific error before
assuming a code problem — the boot-time verify in §7 already proved the credentials work, so a
failure here is more likely something environment-specific (a firewall blocking outbound SMTP,
for instance).

---

## 9. Remove local credentials

The step this whole document has been building toward. Once §8 confirms everything works
**from the server**, nothing about setup should still exist anywhere else:

- [ ] Delete the downloaded service-account JSON key from whichever laptop ran §4
      (`rm ~/Downloads/<project>-*.json` or wherever it landed).
- [ ] Delete any local `.env` used to test these values before they went into
      `/etc/bfl-cash-form/server.env` — including on this machine, if this setup was rehearsed
      locally first.
- [ ] Clear shell history on any machine where a secret was typed directly into a terminal
      (`history -c`, or delete the relevant lines from `~/.bash_history` /
      `~/.zsh_history`).
- [ ] Confirm `/etc/bfl-cash-form/server.env` is the **only** copy of these values that exists
      outside Google's/BFL's own credential stores, and that it's `640`-permissioned as set in
      §6.

If there's ever doubt a secret stayed private — it was screen-shared, pasted somewhere it
shouldn't have been, etc. — rotate it rather than hoping: a new service-account key can be
generated from Cloud Console at any time (delete the old one after confirming the new one
works), and SMTP passwords/app passwords can be regenerated the same way.

---

## 10. Ongoing operations

- **Spool monitoring** — `GET /api/health`'s `spoolDepth` should stay at `0`. A nonzero value
  means mail delivery is failing and forms are queued rather than lost; drain it with
  `POST /api/spool/flush` once the underlying issue (usually the SMTP relay) is fixed.
- **Logs** — `journalctl -u bfl-cash-form`, rotated automatically by systemd's journal; adjust
  retention in `/etc/systemd/journald.conf` if BFL has a log-retention policy to meet.
- **TLS renewal** — certbot's systemd timer handles this; confirm it's active with
  `systemctl list-timers | grep certbot`.
- **Credential rotation** — rotate the service-account key and the SMTP password on whatever
  schedule BFL's security policy requires; both are drop-in replacements in
  `/etc/bfl-cash-form/server.env` followed by `sudo systemctl restart bfl-cash-form`.
- **Deploying updates** — `git pull`, re-run the `npm ci`/`npm run build` steps in §7, then
  `sudo systemctl restart bfl-cash-form`. Nothing in this flow touches
  `/etc/bfl-cash-form/server.env`, so updates never risk the production credentials.
