import { config, isLedgerConfigured } from './config.js'
import { GRAPH, getGraphToken } from './graph.js'
import { groupAccountNumber } from './mail/messages.js'

const formatDateTime = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso ?? '')
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const workbookPathSegment = () => encodeURI(config.ledger.path)

/**
 * One ledger row per submission. Deliberately mirrors the internal audit
 * email's field list exactly (mail/messages.js's internalMessage) — this is
 * the audit version, not the customer copy, so Device ID/IP/consent belong
 * here. Pure: no network, so it's directly testable.
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
 * Appends one row to the Excel table backing the ledger. Never throws — this
 * is a bonus ledger, not the source of truth (the PDF archive and the audit
 * email are), so a Graph/Excel outage is logged and the submission proceeds
 * regardless.
 *
 * Uses the Graph Excel "rows/add" action against a Table already defined in
 * the workbook (Insert > Table in Excel, named EXCEL_TABLE — see
 * server/.env.example). Values are sent as plain strings/numbers, never as
 * formulas, so untrusted customer-typed text (e.g. a phone number starting
 * with "+") can never be interpreted as a spreadsheet formula.
 */
export const appendTransactionRow = async ({ payload, mail, archive }) => {
  if (!isLedgerConfigured()) return { logged: false, reason: 'not configured' }

  try {
    const token = await getGraphToken(config.sharepoint)
    const table = encodeURIComponent(config.ledger.table)
    const res = await fetch(
      `${GRAPH}/drives/${config.sharepoint.driveId}/root:/${workbookPathSegment()}:/workbook/tables/${table}/rows/add`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ values: [buildTransactionRow({ payload, mail, archive })] }),
        signal: AbortSignal.timeout(config.sharepoint.timeoutMs),
      },
    )
    if (!res.ok) throw new Error(`Excel append failed: ${res.status} ${await res.text()}`)

    console.log(`[ledger] logged ${payload.meta.referenceNo}`)
    return { logged: true }
  } catch (error) {
    console.error(`[ledger] failed to log ${payload.meta.referenceNo} — ${error.message}`)
    return { logged: false, reason: error.message }
  }
}

/**
 * Startup check, run only when the ledger is configured at all (preflight.js
 * treats it as optional, same as the Sheets version did). Confirms the
 * workbook file itself is reachable at EXCEL_PATH — a wrong path or a
 * missing table would otherwise only surface on the first real submission.
 */
export const verifyLedgerConfig = async () => {
  const token = await getGraphToken(config.sharepoint)
  const res = await fetch(`${GRAPH}/drives/${config.sharepoint.driveId}/root:/${workbookPathSegment()}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Ledger workbook unreachable: ${res.status} ${await res.text()}`)
  return true
}
