import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { config, configProblems, isDriveConfigured, isSheetsConfigured } from './config.js'

/* config is computed once from process.env at import time, so tests exercise
   it the same way spool.test.js already does — mutate the object directly
   and restore it afterward, rather than re-importing with different env. */
const snapshot = () => JSON.parse(JSON.stringify({ mail: config.mail, google: config.google }))
let saved

beforeEach(() => {
  saved = snapshot()
})

afterEach(() => {
  Object.assign(config.mail, saved.mail)
  Object.assign(config.google, saved.google)
  Object.assign(config.google.drive, saved.google.drive)
  Object.assign(config.google.sheets, saved.google.sheets)
})

const setGoogleAuth = () => {
  config.google.oauthClientId = 'client-id'
  config.google.oauthClientSecret = 'client-secret'
  config.google.oauthRefreshToken = 'refresh-token'
}

const clearGoogleAuth = () => {
  config.google.oauthClientId = undefined
  config.google.oauthClientSecret = undefined
  config.google.oauthRefreshToken = undefined
}

test('configProblems is empty once mail and Drive are both configured', () => {
  config.mail.smtp.host = 'smtp.example.com'
  setGoogleAuth()
  config.google.drive.folderId = 'folder-id'

  assert.deepEqual(configProblems(), [])
})

test('names a missing mail transport by itself', () => {
  config.mail.smtp.host = undefined
  setGoogleAuth()
  config.google.drive.folderId = 'folder-id'

  const problems = configProblems()
  assert.equal(problems.length, 1)
  assert.match(problems[0], /No mail transport configured/)
})

test('names a missing Drive config by itself', () => {
  config.mail.smtp.host = 'smtp.example.com'
  clearGoogleAuth()
  config.google.drive.folderId = undefined

  const problems = configProblems()
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Google Drive archive not configured/)
})

test('names both when neither is configured', () => {
  config.mail.smtp.host = undefined
  clearGoogleAuth()
  config.google.drive.folderId = undefined

  assert.equal(configProblems().length, 2)
})

test('isDriveConfigured requires the full OAuth authorization plus the folder ID', () => {
  clearGoogleAuth()
  config.google.drive.folderId = undefined
  assert.equal(isDriveConfigured(), false)

  setGoogleAuth()
  assert.equal(isDriveConfigured(), false, 'missing folderId')

  config.google.drive.folderId = 'folder-id'
  assert.equal(isDriveConfigured(), true)
})

test('isDriveConfigured requires all three OAuth values, not just some', () => {
  setGoogleAuth()
  config.google.drive.folderId = 'folder-id'
  config.google.oauthRefreshToken = undefined

  assert.equal(isDriveConfigured(), false, 'missing refresh token alone should fail the gate')
})

test('isSheetsConfigured requires the shared Google authorization plus the spreadsheet ID', () => {
  clearGoogleAuth()
  config.google.sheets.spreadsheetId = undefined
  assert.equal(isSheetsConfigured(), false)

  setGoogleAuth()
  assert.equal(isSheetsConfigured(), false, 'missing spreadsheetId')

  config.google.sheets.spreadsheetId = 'sheet-id'
  assert.equal(isSheetsConfigured(), true)
})

test('Drive and Sheets share the Google authorization but gate on their own IDs independently', () => {
  setGoogleAuth()
  config.google.drive.folderId = 'folder-id'
  config.google.sheets.spreadsheetId = undefined

  assert.equal(isDriveConfigured(), true)
  assert.equal(isSheetsConfigured(), false)
})
