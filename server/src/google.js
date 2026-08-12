import { config } from './config.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/* OAuth 2.0 user-consent flow, not a service account: uploads happen as the
   actual Google account that authorized this app, using its own Drive
   storage. Service accounts have none of their own outside a paid Workspace
   Shared Drive — that's what ruled the service-account approach out; see
   the README's "Setting up Google access".

   The refresh token is minted once, interactively, by
   scripts/google-oauth-setup.mjs. This module only ever exchanges it for
   short-lived access tokens, cached the same way the previous service-
   account flow cached its JWT-derived token. */

let cached = null

export const getGoogleToken = async () => {
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.oauthClientId,
      client_secret: config.google.oauthClientSecret,
      refresh_token: config.google.oauthRefreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(config.google.timeoutMs),
  })

  const body = await res.text()
  if (!res.ok) {
    throw new Error(
      `Google token refresh failed: ${res.status} ${body}. If the refresh token was revoked or ` +
        'expired, run `npm run google:auth` again.',
    )
  }

  const { access_token: token, expires_in: expiresIn } = JSON.parse(body)
  cached = { token, expiresAt: Date.now() + (Number(expiresIn ?? 3600) - 60) * 1000 }
  return token
}

/** Lets the tests start from a clean cache. */
export const resetGoogleToken = () => {
  cached = null
}
