/** Central place for every environment-driven setting. No secrets in code. */

/** Shared shape for every comma-separated env var below. */
const list = (value, fallback = '') =>
  (value ?? fallback)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * How many reverse proxies sit in front of this service. Express uses it to
 * decide how much of X-Forwarded-For to believe, and that decision decides
 * whether the IP recorded on a form is evidence or decoration: the previous
 * `true` meant "trust every hop", so any caller could set the header and
 * choose the address that went into the audit mail and the ledger.
 *
 * 0 (the default) = tablets connect directly, so the header is ignored
 * entirely. Set it to the real number of proxies, or to a specific proxy
 * address/subnet, only once that is actually true.
 */
const trustProxySetting = () => {
  const raw = (process.env.TRUST_PROXY ?? '0').trim()
  if (raw === '' || raw.toLowerCase() === 'false') return false
  if (/^\d+$/.test(raw)) return Number(raw)
  // An address or CIDR list — Express matches the hop against it.
  return list(raw)
}

export const config = {
  port: Number(process.env.PORT ?? 8787),

  /** Comma-separated list of origins the tablets are served from. */
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, 'http://localhost:5173'),

  trustProxy: trustProxySetting(),

  /**
   * API credentials. Both are comma-separated so a key can be rotated by
   * adding the new one, moving the tablets over, then removing the old.
   * Nothing here has a default: an unset list means the matching endpoints
   * refuse every request (auth.js fails closed) rather than serving anyone
   * who can reach the port.
   */
  auth: {
    /** Tablets — POST /api/submissions, GET /api/client-ip. */
    deviceKeys: list(process.env.API_KEYS),
    /** Support/IT — the spool endpoints and full health detail. */
    adminKeys: list(process.env.ADMIN_API_KEYS),
  },

  /** Per-IP request ceilings. Each submission fans out into two emails, a
   *  Drive upload and a Sheets append, so an unthrottled endpoint amplifies
   *  a simple loop into mail volume and API quota. */
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    submissions: Number(process.env.RATE_LIMIT_SUBMISSIONS ?? 60),
    general: Number(process.env.RATE_LIMIT_GENERAL ?? 300),
  },

  mail: {
    /** Every completed form goes here, per the operational requirement. */
    to: process.env.MAIL_TO ?? 'it.support@bfl.la',
    /** Must be a real licensed mailbox — SMTP providers commonly reject a
     *  mismatched envelope sender (Gmail always does). */
    from: process.env.MAIL_FROM ?? 'no-reply@bfl.la',

    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },

    retry: {
      attempts: Number(process.env.MAIL_RETRY_ATTEMPTS ?? 3),
      baseDelayMs: Number(process.env.MAIL_RETRY_BASE_MS ?? 400),
    },

    timeouts: {
      request: Number(process.env.MAIL_TIMEOUT_MS ?? 15000),
    },
  },

  /**
   * One Google authorization backs both the PDF archive (Drive) and the
   * optional transaction ledger (Sheets). Two shapes are accepted, and
   * google.js prefers the first:
   *
   *   service account  GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY. The
   *     production shape. Access belongs to the bank, via a Shared Drive the
   *     service account is granted on (deploy.md §4) — which is what answers
   *     the old objection that a service account has no Drive storage of its
   *     own. Nobody's personal Google session can revoke it by leaving.
   *   personal OAuth   GOOGLE_OAUTH_CLIENT_ID + _SECRET + _REFRESH_TOKEN.
   *     The original shape: the app acts as whichever account ran
   *     `npm run google:auth`. Kept for local development, and so an existing
   *     deployment does not break the moment this lands.
   *
   * See google.js for how each is exchanged for an access token.
   */
  google: {
    /** Service account — the `client_email` field of its JSON key. */
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    /**
     * The `private_key` field of that same JSON key. Env vars cannot hold
     * real newlines, so a key pasted from the JSON arrives with literal \n
     * two-character sequences; they are restored here rather than in
     * google.js, so every consumer sees a usable PEM.
     */
    privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),

    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    /** Minted once, interactively, by scripts/google-oauth-setup.mjs. */
    oauthRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    timeoutMs: Number(process.env.GOOGLE_TIMEOUT_MS ?? 15000),

    /** The PDF archive — the operational requirement, same standing as mail. */
    drive: {
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    },

    /** Optional transaction ledger — a bonus on top of the PDF archive and the
     *  audit email, not a replacement for either. See sheets.js. */
    sheets: {
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      tab: process.env.GOOGLE_SHEETS_TAB ?? 'Transactions',
    },
  },

  /** Where undeliverable forms are spooled — see spool.js — so a submission
   *  is never lost if mail or the archive is briefly down. Nothing else
   *  writes here: production requires real mail and Drive config. */
  outbox: process.env.OUTBOX_DIR ?? 'outbox',

  /** Which spool driver backs that promise: 'fs' (default) for any host with
   *  a persistent disk, 'blob' for the serverless deployment, whose
   *  filesystem does not survive the invocation that wrote to it. Defaulting
   *  to 'fs' keeps the VPS and local behaviour unchanged. */
  spoolDriver: (process.env.SPOOL_DRIVER ?? 'fs').trim().toLowerCase(),
}

/** Only the host is required: internal relays and direct-to-MX delivery accept
 *  mail without authenticating, and demanding a username would rule them out. */
export const isSmtpConfigured = () => Boolean(config.mail.smtp.host)

/** Kept for the existing callers that only ask "can we email at all?" —
 *  SMTP is the only transport now, but the name stays general on purpose. */
export const isMailConfigured = () => isSmtpConfigured()

export const mailTransports = () => (isSmtpConfigured() ? ['smtp'] : [])

/** True when the service account's key pair is present and complete. */
export const isServiceAccountConfigured = () =>
  Boolean(config.google.clientEmail && config.google.privateKey)

/** True when the personal-OAuth trio is present and complete. */
const isOauthConfigured = () =>
  Boolean(config.google.oauthClientId && config.google.oauthClientSecret && config.google.oauthRefreshToken)

/* Either shape will do. Deliberately not "all five": requiring both would
   make the service-account migration a flag day, and accepting a half-filled
   one would let the service boot toward a token exchange that cannot work. */
const isGoogleAuthConfigured = () => isServiceAccountConfigured() || isOauthConfigured()

export const isDriveConfigured = () => isGoogleAuthConfigured() && Boolean(config.google.drive.folderId)

export const isSheetsConfigured = () => isGoogleAuthConfigured() && Boolean(config.google.sheets.spreadsheetId)

/**
 * What's missing before this can run as a real branch service, in plain
 * language. Empty means the service is ready to boot. Pure — reads the
 * already-computed `config` object, so tests can exercise it by mutating
 * `config` directly rather than re-importing with different env vars.
 */
export const configProblems = () => {
  const problems = []

  if (config.auth.deviceKeys.length === 0) {
    problems.push(
      'No device API keys configured. Set API_KEYS to one or more secrets the tablets send ' +
        'as `Authorization: Bearer <key>`. Generate one with `openssl rand -hex 32`.',
    )
  }

  if (config.auth.adminKeys.length === 0) {
    problems.push(
      'No admin API keys configured. Set ADMIN_API_KEYS — these guard the spool endpoints, ' +
        'which expose queued submissions and can trigger a mail flush.',
    )
  }

  if (config.auth.deviceKeys.some((key) => config.auth.adminKeys.includes(key))) {
    problems.push('A device key is also listed as an admin key — the tablets would gain spool access.')
  }

  const weak = [...config.auth.deviceKeys, ...config.auth.adminKeys].filter((key) => key.length < 24)
  if (weak.length > 0) {
    problems.push(`${weak.length} API key(s) are shorter than 24 characters. Use \`openssl rand -hex 32\`.`)
  }

  if (!isMailConfigured()) {
    problems.push('No mail transport configured. Set SMTP_HOST (and friends). See server/.env.example.')
  }

  if (!isDriveConfigured()) {
    problems.push(
      'Google Drive archive not configured. Set GOOGLE_DRIVE_FOLDER_ID, plus one credential ' +
        'shape: GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY from a service account key ' +
        '(production — see deploy.md §4), or GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET ' +
        'and a GOOGLE_OAUTH_REFRESH_TOKEN from `npm run google:auth` (local development). ' +
        'See server/.env.example.',
    )
  }

  if (!['fs', 'blob'].includes(config.spoolDriver)) {
    problems.push(`SPOOL_DRIVER is "${config.spoolDriver}" — it must be "fs" or "blob". See server/src/spool.js.`)
  }

  /* The blob driver's whole reason for existing is that the deployment has no
     durable disk, so an unusable token there is not a degraded spool — it is
     no spool at all, on the one deployment that cannot fall back to one. */
  if (config.spoolDriver === 'blob' && !process.env.BLOB_READ_WRITE_TOKEN) {
    problems.push(
      'SPOOL_DRIVER=blob but BLOB_READ_WRITE_TOKEN is not set. Create a Blob store on the ' +
        'Vercel project and connect it — undeliverable forms have nowhere durable to go without it.',
    )
  }

  return problems
}
