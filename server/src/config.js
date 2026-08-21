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
   * One Entra app registration (client-credentials grant) backs both the PDF
   * archive and the optional transaction ledger — the app authenticates as
   * itself, not as a user, and uploads land in a SharePoint/OneDrive drive
   * the app registration has been granted access to. See graph.js.
   */
  sharepoint: {
    tenantId: process.env.SP_TENANT_ID,
    clientId: process.env.SP_CLIENT_ID,
    clientSecret: process.env.SP_CLIENT_SECRET,
    /** The drive (OneDrive or a SharePoint document library) PDFs and the
     *  ledger workbook live in. */
    driveId: process.env.SP_DRIVE_ID,
    /** The PDF archive's parent folder within that drive — the operational
     *  requirement, same standing as mail. */
    folder: process.env.SP_FOLDER ?? 'CashForms',
    timeoutMs: Number(process.env.SP_TIMEOUT_MS ?? 15000),
  },

  /** Optional transaction ledger — a bonus on top of the PDF archive and the
   *  audit email, not a replacement for either. An Excel workbook in the
   *  same SharePoint/OneDrive drive, with a Table already defined in it.
   *  See excel.js. */
  ledger: {
    /** Path to the .xlsx file within the SharePoint/OneDrive drive above. */
    path: process.env.EXCEL_PATH,
    /** Name of the Table (Insert > Table in Excel) rows get appended to. */
    table: process.env.EXCEL_TABLE ?? 'Transactions',
  },

  /** Where undeliverable forms are spooled — see spool.js — so a submission
   *  is never lost if mail or the archive is briefly down. Nothing else
   *  writes here: production requires real mail and Drive config. */
  outbox: process.env.OUTBOX_DIR ?? 'outbox',
}

/** Only the host is required: internal relays and direct-to-MX delivery accept
 *  mail without authenticating, and demanding a username would rule them out. */
export const isSmtpConfigured = () => Boolean(config.mail.smtp.host)

/** Kept for the existing callers that only ask "can we email at all?" —
 *  SMTP is the only transport now, but the name stays general on purpose. */
export const isMailConfigured = () => isSmtpConfigured()

export const mailTransports = () => (isSmtpConfigured() ? ['smtp'] : [])

const isGraphAppConfigured = () =>
  Boolean(config.sharepoint.tenantId && config.sharepoint.clientId && config.sharepoint.clientSecret)

export const isSharePointConfigured = () => isGraphAppConfigured() && Boolean(config.sharepoint.driveId)

export const isLedgerConfigured = () => isGraphAppConfigured() && Boolean(config.ledger.path)

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

  if (!isSharePointConfigured()) {
    problems.push(
      'SharePoint/OneDrive archive not configured. Set SP_TENANT_ID, SP_CLIENT_ID, ' +
        'SP_CLIENT_SECRET (from an Entra app registration with Files.ReadWrite.All or ' +
        'Sites.ReadWrite.All application permission, admin-consented) and SP_DRIVE_ID. ' +
        'See server/.env.example.',
    )
  }

  return problems
}
