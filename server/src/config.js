/** Central place for every environment-driven setting. No secrets in code. */

/* The mail sender and the SharePoint archive normally live behind the same
   Entra app registration, so the Graph mail credentials default to the SP_*
   values and only need overriding when IT keeps them apart. */
const graphMail = {
  tenantId: process.env.MAIL_GRAPH_TENANT_ID ?? process.env.SP_TENANT_ID,
  clientId: process.env.MAIL_GRAPH_CLIENT_ID ?? process.env.SP_CLIENT_ID,
  clientSecret: process.env.MAIL_GRAPH_CLIENT_SECRET ?? process.env.SP_CLIENT_SECRET,
}

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
    /** Must be a real licensed mailbox — Graph refuses to send as an alias. */
    from: process.env.MAIL_FROM ?? 'no-reply@bfl.la',

    /** 'auto' prefers Graph and falls back to SMTP; 'graph'/'smtp' pin one. */
    transport: process.env.MAIL_TRANSPORT ?? 'auto',

    graph: graphMail,

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
      /** Graph HTTP calls, and the SMTP connection/greeting/socket budget. */
      request: Number(process.env.MAIL_TIMEOUT_MS ?? 15000),
    },
  },

  sharepoint: {
    tenantId: process.env.SP_TENANT_ID,
    clientId: process.env.SP_CLIENT_ID,
    clientSecret: process.env.SP_CLIENT_SECRET,
    /** Graph drive that holds the archive, plus the folder inside it. */
    driveId: process.env.SP_DRIVE_ID,
    folder: process.env.SP_FOLDER ?? 'CashForms',
  },

  /** Optional transaction ledger — a bonus on top of the PDF archive and the
   *  audit email, not a replacement for either. See sheets.js. */
  sheets: {
    clientEmail: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    /** Service-account keys are usually pasted into .env with literal \n
     *  sequences rather than real newlines — unescaped here, the one place
     *  that shapes raw env strings into what the code actually needs. */
    privateKey: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    tab: process.env.GOOGLE_SHEETS_TAB ?? 'Transactions',
    timeoutMs: Number(process.env.GOOGLE_SHEETS_TIMEOUT_MS ?? 15000),
  },

  /** Where undeliverable forms are spooled — see spool.js — so a submission
   *  is never lost if mail or the archive is briefly down. Nothing else
   *  writes here: production requires real mail and SharePoint config. */
  outbox: process.env.OUTBOX_DIR ?? 'outbox',
}

/** Only the host is required: internal relays and direct-to-MX delivery accept
 *  mail without authenticating, and demanding a username would rule them out. */
export const isSmtpConfigured = () => Boolean(config.mail.smtp.host)

export const isGraphMailConfigured = () =>
  Boolean(config.mail.graph.tenantId && config.mail.graph.clientId && config.mail.graph.clientSecret)

/** Kept for the existing callers that only ask "can we email at all?". */
export const isMailConfigured = () => isSmtpConfigured() || isGraphMailConfigured()

/**
 * The transports to try, in order. `auto` prefers Graph because Microsoft 365
 * tenants usually have SMTP AUTH switched off, and falls back to the relay.
 */
export const mailTransports = () => {
  const available = { graph: isGraphMailConfigured(), smtp: isSmtpConfigured() }
  if (config.mail.transport === 'graph') return available.graph ? ['graph'] : []
  if (config.mail.transport === 'smtp') return available.smtp ? ['smtp'] : []
  return ['graph', 'smtp'].filter((name) => available[name])
}

export const isSharePointConfigured = () =>
  Boolean(
    config.sharepoint.tenantId &&
      config.sharepoint.clientId &&
      config.sharepoint.clientSecret &&
      config.sharepoint.driveId,
  )

export const isSheetsConfigured = () =>
  Boolean(config.sheets.clientEmail && config.sheets.privateKey && config.sheets.spreadsheetId)

/**
 * What's missing before this can run as a real branch service, in plain
 * language. Empty means the service is ready to boot. Pure — reads the
 * already-computed `config` object, so tests can exercise it by mutating
 * `config` directly rather than re-importing with different env vars.
 */
export const configProblems = () => {
  const problems = []

  if (!isMailConfigured()) {
    problems.push(
      'No mail transport configured. Set MAIL_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET ' +
        '(or reuse the SharePoint ones below) for Microsoft Graph, and/or SMTP_HOST for an ' +
        'SMTP relay. See server/.env.example.',
    )
  }

  if (!isSharePointConfigured()) {
    problems.push(
      'SharePoint archive not configured. Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET ' +
        'and SP_DRIVE_ID. See server/.env.example.',
    )
  }

  return problems
}
