import { test } from 'node:test'
import assert from 'node:assert/strict'
import { internalMessage, customerMessage } from './messages.js'

const payload = {
  kind: 'deposit',
  accountName: 'Souphaphone Vongsa',
  accountNumber: '010123456701234512',
  accountCurrency: 'LAK',
  amount: '2000000',
  amountDisplay: '2,000,000',
  amountInWords: 'Two million Lao Kip only',
  amountCurrency: 'LAK',
  sourceOfFunds: 'Monthly salary income.',
  processedByPhone: '+856 20 5551 2345',
  consent: true,
  copyToEmail: 'customer@example.la',
  meta: {
    referenceNo: 'BFL-20260812-5268',
    submittedAt: '2026-08-12T09:38:00.000Z',
    branch: 'Lane Xang Avenue Branch — Vientiane Capital',
    deviceId: 'TAB-DFDF4E25',
    ip: '10.24.8.51',
  },
}

test('internal message carries the full audit record', () => {
  const message = internalMessage(payload)

  assert.equal(message.to[0], 'it.support@bfl.la')
  assert.match(message.subject, /Cash Deposit/)
  assert.match(message.subject, /BFL-20260812-5268/)

  for (const expected of [
    'TAB-DFDF4E25',
    '10.24.8.51',
    'given electronically',
    'Two million Lao Kip only',
    '2,000,000 LAK',
    'Lane Xang Avenue Branch',
    '+856 20 5551 2345',
  ]) {
    assert.ok(message.text.includes(expected), `internal text should mention ${expected}`)
  }
})

test('internal message flags a missing consent rather than staying silent', () => {
  const message = internalMessage({ ...payload, consent: false })
  assert.match(message.text, /NOT RECORDED/)
})

test('customer message never leaks device provenance or the consent audit line', () => {
  const message = customerMessage(payload)
  const everything = `${message.subject}\n${message.text}\n${message.html}`

  for (const secret of ['TAB-DFDF4E25', '10.24.8.51', 'given electronically', 'consent']) {
    assert.ok(
      !everything.toLowerCase().includes(secret.toLowerCase()),
      `customer copy must not contain ${secret}`,
    )
  }
})

test('customer message tells the customer what they need', () => {
  const message = customerMessage(payload)

  assert.deepEqual(message.to, ['customer@example.la'])
  assert.match(message.text, /BFL-20260812-5268/)
  assert.match(message.text, /Two million Lao Kip only/)
  assert.match(message.text, /2,000,000 LAK/)
  assert.match(message.text, /Souphaphone Vongsa/)
})

test('account number is grouped 3-7-2-4-2 in both messages', () => {
  assert.match(internalMessage(payload).text, /010 1234567 01 2345 12/)
  assert.match(customerMessage(payload).text, /010 1234567 01 2345 12/)
})

test('withdrawal wording differs from deposit wording', () => {
  const message = customerMessage({ ...payload, kind: 'withdrawal' })
  assert.match(message.subject, /withdrawal/i)
  assert.match(message.text, /Amount withdrawn/)
})

test('html is escaped so a name cannot inject markup', () => {
  const message = customerMessage({ ...payload, accountName: 'A <script>alert(1)</script>' })
  assert.ok(!message.html.includes('<script>'), 'script tag must be escaped')
  assert.match(message.html, /&lt;script&gt;/)
})
