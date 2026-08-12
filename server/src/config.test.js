import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { config, configProblems, isSheetsConfigured } from './config.js'

/* config is computed once from process.env at import time, so tests exercise
   it the same way spool.test.js already does — mutate the object directly
   and restore it afterward, rather than re-importing with different env. */
const snapshot = () => JSON.parse(JSON.stringify({ mail: config.mail, sharepoint: config.sharepoint, sheets: config.sheets }))
let saved

beforeEach(() => {
  saved = snapshot()
})

afterEach(() => {
  Object.assign(config.mail, saved.mail)
  Object.assign(config.sharepoint, saved.sharepoint)
  Object.assign(config.sheets, saved.sheets)
})

test('configProblems is empty once mail and SharePoint are both configured', () => {
  config.mail.smtp.host = 'smtp.example.com'
  config.sharepoint.tenantId = 't'
  config.sharepoint.clientId = 'c'
  config.sharepoint.clientSecret = 's'
  config.sharepoint.driveId = 'd'

  assert.deepEqual(configProblems(), [])
})

test('names a missing mail transport by itself', () => {
  config.mail.smtp.host = undefined
  config.mail.graph.tenantId = undefined
  config.mail.graph.clientId = undefined
  config.mail.graph.clientSecret = undefined
  config.sharepoint.tenantId = 't'
  config.sharepoint.clientId = 'c'
  config.sharepoint.clientSecret = 's'
  config.sharepoint.driveId = 'd'

  const problems = configProblems()
  assert.equal(problems.length, 1)
  assert.match(problems[0], /No mail transport configured/)
})

test('names a missing SharePoint config by itself', () => {
  config.mail.smtp.host = 'smtp.example.com'
  config.sharepoint.tenantId = undefined
  config.sharepoint.clientId = undefined
  config.sharepoint.clientSecret = undefined
  config.sharepoint.driveId = undefined

  const problems = configProblems()
  assert.equal(problems.length, 1)
  assert.match(problems[0], /SharePoint archive not configured/)
})

test('names both when neither is configured', () => {
  config.mail.smtp.host = undefined
  config.mail.graph.tenantId = undefined
  config.mail.graph.clientId = undefined
  config.mail.graph.clientSecret = undefined
  config.sharepoint.tenantId = undefined
  config.sharepoint.clientId = undefined
  config.sharepoint.clientSecret = undefined
  config.sharepoint.driveId = undefined

  assert.equal(configProblems().length, 2)
})

test('isSheetsConfigured requires all three values', () => {
  config.sheets.clientEmail = undefined
  config.sheets.privateKey = undefined
  config.sheets.spreadsheetId = undefined
  assert.equal(isSheetsConfigured(), false)

  config.sheets.clientEmail = 'svc@example.iam.gserviceaccount.com'
  config.sheets.privateKey = 'key'
  assert.equal(isSheetsConfigured(), false, 'missing spreadsheetId')

  config.sheets.spreadsheetId = 'sheet-id'
  assert.equal(isSheetsConfigured(), true)
})
