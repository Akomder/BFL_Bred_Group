import { config } from './config.js'
import { PermanentError } from './retry.js'

export const GRAPH = 'https://graph.microsoft.com/v1.0'

/* One token serves both the SharePoint archive and the ledger: the same
   app registration is behind them, and a token is good for about an hour.
   Cached per credential set so a config change cannot serve a stale token. */
let cached = null

const cacheKey = ({ tenantId, clientId, clientSecret }) => `${tenantId}|${clientId}|${clientSecret}`

/**
 * Client-credentials token for Microsoft Graph. Re-used until a minute before
 * it expires, so a burst of submissions costs one round trip, not one each.
 */
export const getGraphToken = async (credentials) => {
  const key = cacheKey(credentials)
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.token

  const res = await fetch(`https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(config.sharepoint.timeoutMs),
  })

  const body = await res.text()
  if (!res.ok) {
    // A rejected credential will be rejected again next time; only throttling
    // and outages are worth a retry.
    const message = `Graph token failed: ${res.status}`
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new PermanentError(message, { status: res.status, body })
    }
    throw Object.assign(new Error(message), { status: res.status, body })
  }

  const { access_token: token, expires_in: expiresIn } = JSON.parse(body)
  cached = { key, token, expiresAt: Date.now() + (Number(expiresIn ?? 3600) - 60) * 1000 }
  return token
}

/** Drops the cached token. Used after a 401 from Graph. */
export const resetGraphToken = () => {
  cached = null
}
