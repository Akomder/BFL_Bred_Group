import { createSign } from 'node:crypto'
import { config, isServiceAccountConfigured } from './config.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/* Two ways to prove who we are to Google, both ending at the same token
   endpoint and both yielding the same short-lived access token, so nothing
   downstream (drive.js, sheets.js, preflight.js) knows or cares which ran:

     service account  Sign a JWT with the account's private key and exchange
       it. The production shape — access belongs to the bank through a Shared
       Drive the account is granted on, not to one employee's Google session,
       so nobody leaving the company takes the archive with them.
     personal OAuth   Exchange a refresh token minted interactively by
       scripts/google-oauth-setup.mjs. The original shape, kept so local
       development and any deployment not yet migrated keep working.

   The service account wins when both are configured: a deployment that has
   been given one has been migrated on purpose, and silently preferring a
   personal grant that happens to still be in the environment would undo that
   without saying so. */

/** Drive for the PDF archive, Sheets for the optional ledger — nothing else. */
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'].join(' ')

/* Google requires base64url, not base64: JWT segments travel in a URL-safe
   alphabet and carry no padding. */
const base64url = (input) => Buffer.from(input).toString('base64url')

/**
 * Builds and signs the assertion Google exchanges for an access token.
 *
 * Exported for the tests: this is the one part of the service-account flow
 * that can be verified without the network, and a malformed claim set fails
 * as an opaque 400 from Google that says nothing about which field was wrong.
 *
 * `sub` is deliberately absent — that is domain-wide delegation, where the
 * account impersonates a user. Access here comes from granting the service
 * account on the Shared Drive directly (deploy.md §4.4), which is narrower.
 */
export const buildAssertion = ({ clientEmail, privateKey, now = Date.now() }) => {
  const issuedAt = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: issuedAt,
      /* One hour is Google's maximum for this grant; anything longer is
         rejected outright rather than clamped. */
      exp: issuedAt + 3600,
    }),
  )

  const signingInput = `${header}.${claims}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url')
  return `${signingInput}.${signature}`
}

/* Cached across calls and shared by both flows — an access token is good for
   an hour, and Drive plus Sheets plus the preflight would otherwise mint a
   fresh one several times per submission. */
let cached = null

/** The request body for whichever credential shape is configured. */
const grantBody = () => {
  if (isServiceAccountConfigured()) {
    return new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildAssertion({
        clientEmail: config.google.clientEmail,
        privateKey: config.google.privateKey,
      }),
    })
  }

  return new URLSearchParams({
    client_id: config.google.oauthClientId,
    client_secret: config.google.oauthClientSecret,
    refresh_token: config.google.oauthRefreshToken,
    grant_type: 'refresh_token',
  })
}

export const getGoogleToken = async () => {
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const serviceAccount = isServiceAccountConfigured()

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: grantBody(),
    signal: AbortSignal.timeout(config.google.timeoutMs),
  })

  const body = await res.text()
  if (!res.ok) {
    /* The remedy differs per flow and Google's own message names neither, so
       say which credential the service actually tried to use. */
    const remedy = serviceAccount
      ? 'Check GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, that the key has not been disabled, and ' +
        'that the service account is still a member of the Shared Drive.'
      : 'If the refresh token was revoked or expired, run `npm run google:auth` again.'
    throw new Error(
      `Google token request failed (${serviceAccount ? 'service account' : 'oauth'}): ${res.status} ${body}. ${remedy}`,
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
