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
    from: process.env.MAIL_FROM ?? 'no-reply@bfl.la',
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },

  sharepoint: {
    tenantId: process.env.SP_TENANT_ID,
    clientId: process.env.SP_CLIENT_ID,
    clientSecret: process.env.SP_CLIENT_SECRET,
    /** Graph drive that holds the archive, plus the folder inside it. */
    driveId: process.env.SP_DRIVE_ID,
    folder: process.env.SP_FOLDER ?? 'CashForms',
  },

  /** Where the local adapters write when SMTP/SharePoint are not configured. */
  outbox: process.env.OUTBOX_DIR ?? 'outbox',
}

export const isMailConfigured = () => Boolean(config.mail.host && config.mail.user)

export const isSharePointConfigured = () =>
  Boolean(
    config.sharepoint.tenantId &&
      config.sharepoint.clientId &&
      config.sharepoint.clientSecret &&
      config.sharepoint.driveId,
  )
