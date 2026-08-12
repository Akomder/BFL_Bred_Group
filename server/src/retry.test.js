import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry, PermanentError } from './retry.js'

const fast = { baseDelayMs: 1 }

test('returns the first success without retrying', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls += 1
    return 'sent'
  }, fast)

  assert.equal(result, 'sent')
  assert.equal(calls, 1)
})

test('retries a transient failure and succeeds', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls += 1
    if (calls < 3) throw new Error('connection reset')
    return 'sent'
  }, fast)

  assert.equal(result, 'sent')
  assert.equal(calls, 3)
})

test('gives up after the configured number of attempts', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1
        throw new Error('still down')
      },
      { ...fast, attempts: 4 },
    ),
    /still down/,
  )
  assert.equal(calls, 4)
})

test('a permanent error is attempted exactly once', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1
        throw new PermanentError('SMTP rejected the message: 550')
      },
      { ...fast, attempts: 5 },
    ),
    /550/,
  )
  assert.equal(calls, 1, 'a rejected mailbox must not be retried')
})

test('honours retryAfterMs from a throttling response', async () => {
  let calls = 0
  const started = Date.now()

  await withRetry(async () => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('throttled'), { retryAfterMs: 60 })
    return 'sent'
  }, fast)

  assert.ok(Date.now() - started >= 55, 'should have waited out Retry-After')
})

test('reports each retry so an outage is visible in the log', async () => {
  const seen = []
  await withRetry(
    async () => {
      if (seen.length < 2) throw new Error('nope')
      return 'sent'
    },
    { ...fast, onRetry: (error, attempt) => seen.push(attempt) },
  )
  assert.deepEqual(seen, [1, 2])
})
