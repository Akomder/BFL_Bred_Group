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

  /** Where the local adapters write when SMTP/SharePoint are not configured,
   *  and where undeliverable forms are spooled so none is ever lost. */
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
