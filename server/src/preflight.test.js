import { test, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { config } from './config.js'

/* assertReady() calls three real modules (mailer, archive, sheets) that each
   need a live Microsoft/Google tenant to verify against. mock.module lets
   this test prove the one behavior that actually matters here — Sheets
   failing is non-fatal while mail/SharePoint failing is fatal — without
   needing credentials for any of them. */

const snapshot = () =>
  JSON.parse(JSON.stringify({ mail: config.mail, sharepoint: config.sharepoint, sheets: config.sheets }))
let saved

beforeEach(() => {
  saved = snapshot()
  // configProblems() and isSheetsConfigured() both read config.js directly —
  // that's real, even though the network-calling verify functions below are
  // mocked. preflight.js imports isSheetsConfigured from config.js, not from
  // sheets.js, so it's this object that has to say "configured", not a mock.
  config.mail.smtp.host = 'smtp.example.com'
  config.sharepoint.tenantId = 't'
  config.sharepoint.clientId = 'c'
  config.sharepoint.clientSecret = 's'
  config.sharepoint.driveId = 'd'
})

afterEach(() => {
  Object.assign(config.mail, saved.mail)
  Object.assign(config.sharepoint, saved.sharepoint)
  Object.assign(config.sheets, saved.sheets)
  mock.reset()
})

test('a Sheets verify failure is logged but does not stop the service booting', async () => {
  config.sheets.clientEmail = 'svc@example.iam.gserviceaccount.com'
  config.sheets.privateKey = 'key'
  config.sheets.spreadsheetId = 'sheet-id'

  mock.module('./mailer.js', { namedExports: { verifyMailConfig: async () => ({ smtp: 'ok' }) } })
  mock.module('./archive.js', { namedExports: { verifySharePoint: async () => true } })
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
  config.sheets.clientEmail = undefined
  config.sheets.privateKey = undefined
  config.sheets.spreadsheetId = undefined

  mock.module('./mailer.js', { namedExports: { verifyMailConfig: async () => ({ smtp: 'ok' }) } })
  mock.module('./archive.js', { namedExports: { verifySharePoint: async () => true } })
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
  mock.module('./archive.js', { namedExports: { verifySharePoint: async () => true } })
  mock.module('./sheets.js', { namedExports: { verifySheetsConfig: async () => true } })

  const { assertReady } = await import(`./preflight.js?t=${Date.now()}`)
  await assert.rejects(assertReady(), /credentials were rejected/)
})
