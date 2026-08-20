import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from './config.js'
import { isSafeReference, safeFileName, isValidEmail, looksLikePdf, assertWithin } from './validate.js'
import { spool, listSpool } from './spool.js'

/* Regression tests for the findings in SECURITY_AUDIT.md. Each one is written
   as the attack, so a future change that reopens the hole fails here rather
   than in production. */

const PDF = Buffer.from('%PDF-1.7\nfake body')

describe('reference validation (audit #2 — path traversal)', () => {
  test('rejects traversal sequences', () => {
    for (const bad of [
      '../../../../tmp/pwned',
      '..',
      '.',
      '../etc/passwd',
      'a/b',
      'a\\b',
      '.hidden',
      '',
      'x'.repeat(65),
      null,
      undefined,
      42,
    ]) {
      assert.equal(isSafeReference(bad), false, `should reject ${JSON.stringify(bad)}`)
    }
  })

  test('accepts a real reference', () => {
    assert.ok(isSafeReference('BFL20260820143012A1B2C3'))
    assert.ok(isSafeReference('BFL-2026_08.20'))
  })
})

describe('filename sanitisation (audit #2)', () => {
  test('strips traversal to a plain segment', () => {
    assert.equal(safeFileName('../../../../tmp/evil.pdf'), 'evil.pdf')
    assert.equal(safeFileName('..\\..\\windows\\system32\\evil.pdf'), 'evil.pdf')
    assert.equal(safeFileName('/etc/passwd'), 'passwd')
  })

  test('falls back when nothing usable survives', () => {
    assert.equal(safeFileName('../..', 'REF.pdf'), 'REF.pdf')
    assert.equal(safeFileName('', 'REF.pdf'), 'REF.pdf')
    assert.equal(safeFileName('...', 'REF.pdf'), 'REF.pdf')
  })

  test('keeps an ordinary name intact', () => {
    assert.equal(safeFileName('CashDeposit-BFL-2026.pdf'), 'CashDeposit-BFL-2026.pdf')
  })
})

describe('assertWithin (audit #2)', () => {
  test('throws when the target escapes the root', () => {
    assert.throws(() => assertWithin('/srv/outbox/spool', '/srv/outbox/spool/../../../tmp/x'))
    assert.throws(() => assertWithin('/srv/outbox/spool', '/tmp/x'))
  })

  test('allows a path inside the root', () => {
    assert.equal(assertWithin('/srv/outbox/spool', '/srv/outbox/spool/REF/a.pdf'), '/srv/outbox/spool/REF/a.pdf')
  })

  test('is not fooled by a sibling with a shared prefix', () => {
    assert.throws(() => assertWithin('/srv/outbox/spool', '/srv/outbox/spool-evil/a.pdf'))
  })
})

describe('spool writes stay inside the outbox (audit #2, end to end)', () => {
  let dir

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bfl-spool-'))
    config.outbox = dir
  })

  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a traversal reference is refused, nothing is written', async () => {
    const payload = { meta: { referenceNo: '../../../../tmp/pwned' } }
    await assert.rejects(
      () => spool({ payload, pdf: PDF, fileName: 'x.pdf' }, 'test'),
      /Unsafe spool reference/,
    )
    await assert.rejects(() => access(join(tmpdir(), 'pwned')), 'must not have created /tmp/pwned')
  })

  test('a traversal filename lands inside the reference directory', async () => {
    const payload = { meta: { referenceNo: 'BFL20260820TEST01' } }
    const { path } = await spool(
      { payload, pdf: PDF, fileName: '../../../../tmp/evil.pdf' },
      'test',
    )

    assert.ok(path.startsWith(dir), 'spool dir must be under the outbox')
    const written = await readdir(path)
    assert.deepEqual(written.sort(), ['evil.pdf', 'manifest.json'])

    const listed = await listSpool()
    assert.equal(listed[0].fileName, 'evil.pdf', 'manifest records the sanitised name')
  })
})

describe('email validation (audit #3 — open relay / header injection)', () => {
  test('rejects header injection and multi-recipient payloads', () => {
    for (const bad of [
      'victim@example.com\r\nBcc: everyone@example.com',
      'victim@example.com\nCc: x@y.z',
      'a@b.com, c@d.com',
      'a@b.com;c@d.com',
      '"name" <a@b.com>',
      'a@b.com>',
      'no-at-sign',
      'a@b',
      '@b.com',
      'a@.com',
      `${'a'.repeat(250)}@b.com`,
      '',
      null,
    ]) {
      assert.equal(isValidEmail(bad), false, `should reject ${JSON.stringify(bad)}`)
    }
  })

  test('accepts ordinary customer addresses', () => {
    assert.ok(isValidEmail('customer@example.com'))
    assert.ok(isValidEmail('first.last+tag@sub.example.co.uk'))
  })
})

describe('PDF content check (audit #9)', () => {
  test('rejects non-PDF bytes', () => {
    assert.equal(looksLikePdf(Buffer.from('<?php system($_GET[0]); ?>')), false)
    assert.equal(looksLikePdf(Buffer.from('MZ\x90\x00')), false)
    assert.equal(looksLikePdf(Buffer.alloc(0)), false)
    assert.equal(looksLikePdf('%PDF-1.7'), false, 'a string is not a buffer')
  })

  test('accepts a real PDF header', () => {
    assert.ok(looksLikePdf(PDF))
  })
})
