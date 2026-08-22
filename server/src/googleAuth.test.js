import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { config, isDriveConfigured, isSheetsConfigured, isServiceAccountConfigured } from './config.js'
import { getGoogleToken, resetGoogleToken } from './google.js'

/* Which credential the service picks, and what it accepts as configured
   (deploy.md §4.0). config.js documents itself as pure over the already-built
   `config` object, so these mutate it directly rather than re-importing. */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const SERVICE = { clientEmail: 'svc@bfl-forms.iam.gserviceaccount.com', privateKey }
const OAUTH = { oauthClientId: 'id', oauthClientSecret: 'secret', oauthRefreshToken: 'refresh' }
const BLANK = { clientEmail: undefined, privateKey: undefined, oauthClientId: undefined, oauthClientSecret: undefined, oauthRefreshToken: undefined }

const set = (values) => Object.assign(config.google, BLANK, values)

let realFetch
let lastBody

beforeEach(() => {
  realFetch = globalThis.fetch
  lastBody = null
  globalThis.fetch = async (_url, init) => {
    lastBody = Object.fromEntries(init.body)
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 't', expires_in: 3600 }) }
  }
  resetGoogleToken()
})

afterEach(() => {
  globalThis.fetch = realFetch
  Object.assign(config.google, BLANK)
  resetGoogleToken()
})

describe('credential shape (§4.0)', () => {
  test('Drive and Sheets accept the service account alone', () => {
    set({ ...SERVICE })
    config.google.drive.folderId = 'folder'
    config.google.sheets.spreadsheetId = 'sheet'
    assert.ok(isServiceAccountConfigured())
    assert.ok(isDriveConfigured(), 'service account alone must satisfy Drive')
    assert.ok(isSheetsConfigured(), 'service account alone must satisfy Sheets')
  })

  test('Drive and Sheets still accept personal OAuth alone', () => {
    set({ ...OAUTH })
    config.google.drive.folderId = 'folder'
    config.google.sheets.spreadsheetId = 'sheet'
    assert.equal(isServiceAccountConfigured(), false)
    assert.ok(isDriveConfigured(), 'the pre-existing shape must keep working')
    assert.ok(isSheetsConfigured())
  })

  /* Half a service account is a misconfiguration, not a credential — it must
     not read as configured and send the service toward a doomed exchange. */
  test('a half-filled service account does not count as configured', () => {
    set({ clientEmail: SERVICE.clientEmail })
    assert.equal(isServiceAccountConfigured(), false)
    set({ privateKey })
    assert.equal(isServiceAccountConfigured(), false)
  })
})

describe('credential preference (§4.0)', () => {
  test('signs a JWT when only the service account is configured', async () => {
    set({ ...SERVICE })
    await getGoogleToken()
    assert.equal(lastBody.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    assert.ok(lastBody.assertion?.split('.').length === 3, 'must send a three-segment JWT')
  })

  test('uses the refresh token when only personal OAuth is configured', async () => {
    set({ ...OAUTH })
    await getGoogleToken()
    assert.equal(lastBody.grant_type, 'refresh_token')
    assert.equal(lastBody.refresh_token, 'refresh')
  })

  /* A deployment given a service account was migrated deliberately. Silently
     preferring a personal grant left over in the environment would undo that. */
  test('prefers the service account when both are configured', async () => {
    set({ ...SERVICE, ...OAUTH })
    await getGoogleToken()
    assert.equal(lastBody.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    assert.equal(lastBody.refresh_token, undefined, 'must not fall back to the personal grant')
  })

  test('names the failing credential shape in the error', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid_grant' })
    set({ ...SERVICE })
    await assert.rejects(getGoogleToken(), /service account/)
    resetGoogleToken()
    set({ ...OAUTH })
    await assert.rejects(getGoogleToken(), /oauth/)
  })
})
