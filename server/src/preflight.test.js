import { test, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { config } from './config.js'

/* assertReady() calls three real modules (mailer, drive, sheets) that each
   need a live SMTP relay / Google OAuth authorization to verify against.
   mock.module lets this test prove the one behavior that actually matters
   here — Sheets failing is non-fatal while mail/Drive failing is fatal —
   without needing credentials for any of them. */

const snapshot = () => JSON.parse(JSON.stringify({ mail: config.mail, google: config.google }))
let saved

beforeEach(() => {
  saved = snapshot()
  // configProblems() and isSheetsConfigured() both read config.js directly —
  // that's real, even though the network-calling verify functions below are
  // mocked. preflight.js imports isSheetsConfigured from config.js, not from
  // sheets.js, so it's this object that has to say "configured", not a mock.
  config.mail.smtp.host = 'smtp.example.com'
  config.google.oauthClientId = 'client-id'
  config.google.oauthClientSecret = 'client-secret'
  config.google.oauthRefreshToken = 'refresh-token'
  config.google.drive.folderId = 'folder-id'
})

afterEach(() => {
  Object.assign(config.mail, saved.mail)
  Object.assign(config.google, saved.google)
  Object.assign(config.google.drive, saved.google.drive)
  Object.assign(config.google.sheets, saved.google.sheets)
  mock.reset()
})

test('a Sheets verify failure is logged but does not stop the service booting', async () => {
  config.google.sheets.spreadsheetId = 'sheet-id'

  mock.module('./mailer.js', { namedExports: { verifyMailConfig: async () => ({ smtp: 'ok' }) } })
  mock.module('./drive.js', { namedExports: { verifyDrive: async () => true } })
  mock.module('./sheets.js', {
    namedExports: {
      verifySheetsConfig: async () => {
        throw new Error('Sheet unreachable: 404')
      },
    },
  })

  const { assertReady } = await import(`./preflight.js?t=${Date.now()}`)
  const result = await assertReady()

  assert.match(result.sheets, /FAILED — Sheet unreachable: 404/)
})

test('Sheets left unconfigured boots clean and says so', async () => {
  config.google.sheets.spreadsheetId = undefined

  mock.module('./mailer.js', { namedExports: { verifyMailConfig: async () => ({ smtp: 'ok' }) } })
  mock.module('./drive.js', { namedExports: { verifyDrive: async () => true } })
  mock.module('./sheets.js', {
    namedExports: {
      verifySheetsConfig: async () => {
        throw new Error('should not be called')
      },
    },
  })

  const { assertReady } = await import(`./preflight.js?t=${Date.now()}`)
  const result = await assertReady()

  assert.equal(result.sheets, 'not configured — skipping')
})

test('a mail verify failure is fatal even if Sheets is fine', async () => {
  mock.module('./mailer.js', {
    namedExports: { verifyMailConfig: async () => ({ smtp: 'FAILED — Invalid login' }) },
  })
  mock.module('./drive.js', { namedExports: { verifyDrive: async () => true } })
  mock.module('./sheets.js', { namedExports: { verifySheetsConfig: async () => true } })

  const { assertReady } = await import(`./preflight.js?t=${Date.now()}`)
  await assert.rejects(assertReady(), /credentials were rejected/)
})

test('a Drive verify failure is fatal', async () => {
  mock.module('./mailer.js', { namedExports: { verifyMailConfig: async () => ({ smtp: 'ok' }) } })
  mock.module('./drive.js', {
    namedExports: {
      verifyDrive: async () => {
        throw new Error('Drive folder unreachable: 404')
      },
    },
  })
  mock.module('./sheets.js', { namedExports: { verifySheetsConfig: async () => true } })

  const { assertReady } = await import(`./preflight.js?t=${Date.now()}`)
  await assert.rejects(assertReady(), /credentials were rejected/)
})
