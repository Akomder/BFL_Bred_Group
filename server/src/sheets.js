import { config, isSheetsConfigured } from './config.js'
import { getGoogleToken } from './google.js'
import { groupAccountNumber } from './mail/messages.js'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

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
    const token = await getGoogleToken()
    const range = encodeURIComponent(`${config.google.sheets.tab}!A:Q`)
    /* RAW, not USER_ENTERED: several fields are untrusted, customer-typed text
       (source of funds is 500 free-typed characters) or start with a
       character Sheets treats as a formula prefix (a phone number starting
       with "+"). USER_ENTERED parses cell content the way a human typing
       into the UI would, which turns either case into a formula — at best a
       #ERROR! cell, at worst a live spreadsheet-injection vector in a
       financial audit log. RAW stores every value as the literal string it
       is, never evaluated. */
    const res = await fetch(
      `${SHEETS_API}/${config.google.sheets.spreadsheetId}/values/${range}:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ values: [buildTransactionRow({ payload, mail, archive })] }),
        signal: AbortSignal.timeout(config.google.timeoutMs),
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
 * right and reachable, not just that the credential parses.
 */
export const verifySheetsConfig = async () => {
  const token = await getGoogleToken()
  const res = await fetch(`${SHEETS_API}/${config.google.sheets.spreadsheetId}?fields=spreadsheetId`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(config.google.timeoutMs),
  })
  if (!res.ok) throw new Error(`Sheet unreachable: ${res.status} ${await res.text()}`)
  return true
}
