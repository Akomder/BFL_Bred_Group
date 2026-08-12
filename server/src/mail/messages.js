import { config } from '../config.js'

/* Two audiences, two messages.

   The internal mail is an audit record for it.support@bfl.la and carries
   everything the paper slip carried plus the device provenance. The customer
   advice is a receipt: their transaction, and nothing about the tablet that
   took it. Device ID, IP address and the consent audit line must never appear
   in a message addressed to a member of the public — messages.test.js pins
   that. */

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const kindLabel = (kind) => (kind === 'deposit' ? 'Cash Deposit' : 'Cash Withdrawal')

/** "010 1234567 01 2345 12" — the 3-7-2-4-2 grouping used on the form.
 *  Exported for sheets.js, which formats the same field the same way. */
export const groupAccountNumber = (digits = '') => {
  const blocks = [3, 7, 2, 4, 2]
  let rest = String(digits).replace(/\D/g, '')
  const out = []
  for (const size of blocks) {
    if (!rest) break
    out.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  if (rest) out.push(rest)
  return out.join(' ')
}

/** The client sends the grouped figures; fall back to the raw value. */
const figures = (payload) => payload.amountDisplay || payload.amount

const formatDateTime = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso ?? '')
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const rowsToHtml = (rows) =>
  rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#5b7186;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#0f2a3d;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join('')

const wrapHtml = (title, intro, rows, footer) => `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;color:#0f2a3d">
  <h2 style="margin:0 0 4px;color:#0b5ea8;font-size:20px">${escapeHtml(title)}</h2>
  <p style="margin:0 0 18px;color:#5b7186;font-size:14px">${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse">${rowsToHtml(rows)}</table>
  <p style="margin:20px 0 0;color:#5b7186;font-size:13px">${escapeHtml(footer)}</p>
</div>`

const rowsToText = (rows) => {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2
  return rows.map(([label, value]) => `${(label + ':').padEnd(width)}${value}`).join('\n')
}

/**
 * The full record for it.support@bfl.la: every field from the form, the device
 * provenance, and the electronic-consent line that makes the PDF stand in for
 * a wet signature.
 */
export const internalMessage = (payload) => {
  const { meta } = payload
  const rows = [
    ['Reference', meta.referenceNo],
    ['Account name', payload.accountName],
    ['Account number', groupAccountNumber(payload.accountNumber)],
    ['Amount', `${figures(payload)} ${payload.amountCurrency}`],
    ['Amount in words', payload.amountInWords || '—'],
    ['Account currency', payload.accountCurrency],
    [payload.kind === 'deposit' ? 'Source of funds' : 'Purpose of withdrawal', payload.sourceOfFunds],
    ['Processed by', payload.processedByPhone],
    ['Submitted at', formatDateTime(meta.submittedAt)],
    ['Branch', meta.branch],
    ['Device ID', meta.deviceId],
    ['IP address', meta.ip],
    ['Customer consent', payload.consent ? 'given electronically' : 'NOT RECORDED'],
  ]

  const intro = `A ${kindLabel(payload.kind).toLowerCase()} form was submitted from a branch tablet.`
  const footer = 'The signed PDF is attached.'

  return {
    to: [config.mail.to],
    subject: `${kindLabel(payload.kind)} — ${payload.accountName} — ${meta.referenceNo}`,
    text: [intro, '', rowsToText(rows), '', footer].join('\n'),
    html: wrapHtml(`${kindLabel(payload.kind)} form`, intro, rows, footer),
  }
}

/**
 * The customer's own copy, sent only when they asked for one. Deliberately
 * excludes the Device ID, the IP address and the consent audit line.
 */
export const customerMessage = (payload) => {
  const { meta } = payload
  const rows = [
    ['Reference', meta.referenceNo],
    ['Account name', payload.accountName],
    ['Account number', groupAccountNumber(payload.accountNumber)],
    [
      payload.kind === 'deposit' ? 'Amount deposited' : 'Amount withdrawn',
      `${figures(payload)} ${payload.amountCurrency}`,
    ],
    ['Amount in words', payload.amountInWords || '—'],
    ['Date and time', formatDateTime(meta.submittedAt)],
    ['Branch', meta.branch],
  ]

  const intro = `Thank you, ${payload.accountName}. Here is your copy of the ${kindLabel(payload.kind).toLowerCase()} form you signed at our branch.`
  const footer =
    'A copy of the signed form is attached as a PDF. Please keep it for your records. ' +
    'If anything looks wrong, contact your branch quoting the reference above.'

  return {
    to: [payload.copyToEmail],
    subject: `Your ${kindLabel(payload.kind).toLowerCase()} advice — ${meta.referenceNo}`,
    text: [intro, '', rowsToText(rows), '', footer].join('\n'),
    html: wrapHtml('BFL BRED Group', intro, rows, footer),
  }
}
