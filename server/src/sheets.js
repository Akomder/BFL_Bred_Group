import { createSign } from 'node:crypto'
import { config, isSheetsConfigured } from './config.js'
import { groupAccountNumber } from './mail/messages.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

/* No googleapis dependency, the same way graph.js talks to Microsoft with
   plain fetch rather than an SDK: sign a JWT with the built-in crypto module
   and trade it for an access token via the standard OAuth2 service-account
   flow (RFC 7523). */
const base64url = (input) => Buffer.from(input).toString('base64url')

const signedAssertion = () => {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: config.sheets.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(config.sheets.privateKey, 'base64url')
  return `${header}.${claims}.${signature}`
}

let cached = null

const getSheetsToken = async () => {
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(),
    }),
    signal: AbortSignal.timeout(config.sheets.timeoutMs),
  })

  const body = await res.text()
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${body}`)

  const { access_token: token, expires_in: expiresIn } = JSON.parse(body)
  cached = { token, expiresAt: Date.now() + (Number(expiresIn ?? 3600) - 60) * 1000 }
  return token
}

const formatDateTime = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso ?? '')
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * One ledger row per submission. Deliberately mirrors the internal audit
 * email's field list exactly (messages.js's internalMessage) — this is the
 * audit version, not the customer copy, so Device ID/IP/consent belong here.
 * Pure: no network, so it's directly testable.
 */
export const buildTransactionRow = ({ payload, mail, archive }) => {
  const { meta } = payload
  return [
    meta.referenceNo,
    formatDateTime(meta.submittedAt),
    payload.kind,
    meta.branch,
    meta.deviceId,
    meta.ip,
    payload.accountName,
    groupAccountNumber(payload.accountNumber),
    payload.amountDisplay || payload.amount,
    payload.amountCurrency,
    payload.amountInWords || '',
    payload.sourceOfFunds,
    payload.processedByPhone,
    payload.consent ? 'yes' : 'no',
    mail?.delivered ? `yes (${mail.transport})` : 'no',
    mail?.spooled ? 'yes' : 'no',
    archive?.archived ? 'yes' : 'no',
  ]
}

/**
 * Appends one row. Never throws — this is a bonus ledger, not the source of
 * truth (the PDF archive and the audit email are), so a Sheets outage is
 * logged and the submission proceeds regardless.
 */
export const appendTransactionRow = async ({ payload, mail, archive }) => {
  if (!isSheetsConfigured()) return { logged: false, reason: 'not configured' }

  try {
    const token = await getSheetsToken()
    const range = encodeURIComponent(`${config.sheets.tab}!A:Q`)
    const res = await fetch(
      `${SHEETS_API}/${config.sheets.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ values: [buildTransactionRow({ payload, mail, archive })] }),
        signal: AbortSignal.timeout(config.sheets.timeoutMs),
      },
    )
    if (!res.ok) throw new Error(`Sheets append failed: ${res.status} ${await res.text()}`)

    console.log(`[sheets] logged ${payload.meta.referenceNo}`)
    return { logged: true }
  } catch (error) {
    console.error(`[sheets] failed to log ${payload.meta.referenceNo} — ${error.message}`)
    return { logged: false, reason: error.message }
  }
}

/**
 * Startup check, run only when Sheets is configured at all (preflight.js
 * treats it as optional). A metadata-only read proves the spreadsheet ID is
 * right and the service account has been shared onto it — the mistake people
 * actually make — not just that the credential parses.
 */
export const verifySheetsConfig = async () => {
  const token = await getSheetsToken()
  const res = await fetch(`${SHEETS_API}/${config.sheets.spreadsheetId}?fields=spreadsheetId`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(config.sheets.timeoutMs),
  })
  if (!res.ok) throw new Error(`Sheet unreachable: ${res.status} ${await res.text()}`)
  return true
}
