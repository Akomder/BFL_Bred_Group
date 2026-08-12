import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTransactionRow } from './sheets.js'

const payload = {
  kind: 'deposit',
  accountName: 'Souphaphone Vongsa',
  accountNumber: '010123456701234512',
  amountDisplay: '2,000,000',
  amount: '2000000',
  amountCurrency: 'LAK',
  amountInWords: 'Two million Lao Kip only',
  sourceOfFunds: 'Monthly salary income.',
  processedByPhone: '+856 20 5551 2345',
  consent: true,
  meta: {
    referenceNo: 'BFL-20260812-5268',
    submittedAt: '2026-08-12T09:38:00.000Z',
    branch: 'Lane Xang Avenue Branch — Vientiane Capital',
    deviceId: 'TAB-DFDF4E25',
    ip: '10.24.8.51',
  },
}

test('the ledger row is the audit version, not the customer copy', () => {
  const row = buildTransactionRow({
    payload,
    mail: { delivered: true, transport: 'graph' },
    archive: { archived: true },
  })

  // Unlike messages.js's customer copy, Device ID/IP/consent belong here —
  // this row mirrors the internal audit email field for field.
  assert.ok(row.includes('TAB-DFDF4E25'), 'must include the Device ID')
  assert.ok(row.includes('10.24.8.51'), 'must include the IP')
  assert.ok(row.includes('yes'), 'must reflect consent')

  assert.ok(row.includes('BFL-20260812-5268'))
  assert.ok(row.includes('Souphaphone Vongsa'))
  assert.ok(row.includes('010 1234567 01 2345 12'), 'account number grouped 3-7-2-4-2')
  assert.ok(row.includes('Two million Lao Kip only'))
})

test('reflects delivery, spooling and archive outcome', () => {
  const delivered = buildTransactionRow({
    payload,
    mail: { delivered: true, transport: 'smtp' },
    archive: { archived: true },
  })
  assert.ok(delivered.includes('yes (smtp)'))
  assert.ok(delivered.includes('yes'), 'archived column')

  const spooled = buildTransactionRow({
    payload,
    mail: { delivered: false, spooled: true },
    archive: { archived: false },
  })
  assert.ok(spooled.includes('no'), 'delivered column reads no')
  assert.ok(spooled.includes('yes'), 'spooled column reads yes')
})

test('a row always has the same number of columns regardless of outcome', () => {
  const a = buildTransactionRow({ payload, mail: { delivered: true, transport: 'graph' }, archive: { archived: true } })
  const b = buildTransactionRow({ payload, mail: {}, archive: {} })
  assert.equal(a.length, b.length)
})
