import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from './config.js'
import { spool, listSpool, flushSpool } from './spool.js'

const originalOutbox = config.outbox
let dir

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bfl-spool-'))
  config.outbox = dir
})

afterEach(async () => {
  config.outbox = originalOutbox
  await rm(dir, { recursive: true, force: true })
})

const submission = (referenceNo = 'BFL-20260812-0001') => ({
  payload: {
    kind: 'deposit',
    accountName: 'Souphaphone Vongsa',
    meta: { referenceNo, submittedAt: '2026-08-12T09:38:00.000Z', branch: 'HQ', deviceId: 'TAB-1', ip: '10.0.0.1' },
  },
  pdf: Buffer.from('%PDF-1.7 pretend'),
  fileName: `CashDeposit-${referenceNo}.pdf`,
})

test('an empty spool reads as empty rather than throwing', async () => {
  assert.deepEqual(await listSpool(), [])
})

test('a spooled form is listed with its reason', async () => {
  await spool(submission(), 'smtp: connection refused')

  const items = await listSpool()
  assert.equal(items.length, 1)
  assert.equal(items[0].referenceNo, 'BFL-20260812-0001')
  assert.match(items[0].reason, /connection refused/)
})

test('flushing delivers the form and clears it from the spool', async () => {
  await spool(submission(), 'mail down')

  const sent = []
  const results = await flushSpool(async ({ payload, pdf, fileName }) => {
    sent.push({ referenceNo: payload.meta.referenceNo, fileName, bytes: pdf.length })
    return { delivered: true, transport: 'graph' }
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].delivered, true)
  assert.equal(results[0].transport, 'graph')

  // The PDF and the payload survived the round trip intact.
  assert.equal(sent[0].referenceNo, 'BFL-20260812-0001')
  assert.equal(sent[0].bytes, Buffer.from('%PDF-1.7 pretend').length)

  assert.deepEqual(await listSpool(), [], 'delivered form should leave the spool')
  assert.deepEqual(await readdir(join(dir, 'sent')), ['BFL-20260812-0001'], 'and be kept as evidence')
})

test('a form that still cannot be sent stays spooled', async () => {
  await spool(submission(), 'mail down')

  const results = await flushSpool(async () => ({ delivered: false, reason: 'still down' }))

  assert.equal(results[0].delivered, false)
  assert.equal((await listSpool()).length, 1, 'must not be dropped while undelivered')
})

test('one failing form does not stop the rest of the backlog', async () => {
  await spool(submission('BFL-A'), 'mail down')
  await spool(submission('BFL-B'), 'mail down')

  const results = await flushSpool(async ({ payload }) => {
    if (payload.meta.referenceNo === 'BFL-A') throw new Error('rejected')
    return { delivered: true, transport: 'smtp' }
  })

  assert.equal(results.filter((r) => r.delivered).length, 1)
  assert.deepEqual(
    (await listSpool()).map((i) => i.referenceNo),
    ['BFL-A'],
  )
})
