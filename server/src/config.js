/** Central place for every environment-driven setting. No secrets in code. */

export const config = {
  port: Number(process.env.PORT ?? 8787),

  /** Comma-separated list of origins the tablets are served from. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

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
   * One Google OAuth authorization backs both the PDF archive (Drive) and
   * the optional transaction ledger (Sheets) — the app acts as whichever
   * Google account ran `npm run google:auth`, not as a service account
   * (service accounts have no Drive storage of their own outside a paid
   * Workspace Shared Drive). See google.js.
   */
  google: {
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
}

/** Only the host is required: internal relays and direct-to-MX delivery accept
 *  mail without authenticating, and demanding a username would rule them out. */
export const isSmtpConfigured = () => Boolean(config.mail.smtp.host)

/** Kept for the existing callers that only ask "can we email at all?" —
 *  SMTP is the only transport now, but the name stays general on purpose. */
export const isMailConfigured = () => isSmtpConfigured()

export const mailTransports = () => (isSmtpConfigured() ? ['smtp'] : [])

const isGoogleAuthConfigured = () =>
  Boolean(config.google.oauthClientId && config.google.oauthClientSecret && config.google.oauthRefreshToken)

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

  if (!isMailConfigured()) {
    problems.push('No mail transport configured. Set SMTP_HOST (and friends). See server/.env.example.')
  }

  if (!isDriveConfigured()) {
    problems.push(
      'Google Drive archive not configured. Set GOOGLE_OAUTH_CLIENT_ID and ' +
        'GOOGLE_OAUTH_CLIENT_SECRET, run `npm run google:auth` to get GOOGLE_OAUTH_REFRESH_TOKEN, ' +
        'and set GOOGLE_DRIVE_FOLDER_ID. See server/.env.example.',
    )
  }

  return problems
}
