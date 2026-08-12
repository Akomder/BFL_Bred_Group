import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { config } from './config.js'
import { buildMultipartBody } from './drive.js'

const savedFolderId = config.google.drive.folderId

beforeEach(() => {
  config.google.drive.folderId = 'target-folder-id'
})

afterEach(() => {
  config.google.drive.folderId = savedFolderId
})

test('the multipart body carries the filename, the target folder, and the PDF bytes intact', () => {
  const pdf = Buffer.from('%PDF-1.7 pretend form bytes')
  const body = buildMultipartBody({ fileName: 'CashDeposit-BFL-20260812-0001.pdf', pdf })
  const text = body.toString('latin1')

  assert.match(text, /"name":"CashDeposit-BFL-20260812-0001\.pdf"/)
  assert.match(text, /"parents":\["target-folder-id"\]/)
  assert.match(text, /Content-Type: application\/pdf/)
  assert.ok(body.includes(pdf), 'the raw PDF bytes must appear unmodified in the body')
})

test('the multipart boundary brackets both parts so Drive can split them', () => {
  const body = buildMultipartBody({ fileName: 'a.pdf', pdf: Buffer.from('x') })
  const text = body.toString('latin1')
  const boundaryLines = text.split('\r\n').filter((line) => line.startsWith('--bfl-cash-form-boundary'))

  // Opening boundary before each part, plus the closing boundary at the end.
  assert.equal(boundaryLines.length, 3)
  assert.ok(text.trimEnd().endsWith('--bfl-cash-form-boundary--'))
})
