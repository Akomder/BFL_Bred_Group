import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { buildAssertion } from './google.js'

/* The service-account grant (deploy.md §4.0) fails as an opaque 400 from
   Google when a claim is wrong, which says nothing about which one. These
   assert the claim set directly, against a real key pair, so a malformed
   assertion is caught here instead of at a branch counter. */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const CLIENT_EMAIL = 'bfl-cash-form@bfl-forms.iam.gserviceaccount.com'
const NOW = Date.UTC(2026, 7, 23, 12, 0, 0)

const parts = (jwt) => {
  const [header, claims, signature] = jwt.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    claims: JSON.parse(Buffer.from(claims, 'base64url')),
    signature,
    signingInput: `${header}.${claims}`,
  }
}

const assertion = () => buildAssertion({ clientEmail: CLIENT_EMAIL, privateKey, now: NOW })

describe('service-account assertion (§4.0)', () => {
  test('is signed RS256 and verifies against the matching public key', () => {
    const { header, signingInput, signature } = parts(assertion())
    assert.equal(header.alg, 'RS256')
    assert.equal(header.typ, 'JWT')
    assert.ok(
      createVerify('RSA-SHA256').update(signingInput).verify(publicKey, signature, 'base64url'),
      'signature must verify',
    )
  })

  test('a tampered claim set no longer verifies', () => {
    const { signingInput, signature } = parts(assertion())
    const forged = signingInput.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    assert.equal(
      createVerify('RSA-SHA256').update(forged).verify(publicKey, signature, 'base64url'),
      false,
    )
  })

  test('carries exactly the claims Google requires for this grant', () => {
    const { claims } = parts(assertion())
    assert.equal(claims.iss, CLIENT_EMAIL)
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token')
    assert.equal(claims.iat, Math.floor(NOW / 1000))
  })

  /* Google rejects anything over an hour outright rather than clamping it. */
  test('expires exactly one hour out', () => {
    const { claims } = parts(assertion())
    assert.equal(claims.exp - claims.iat, 3600)
  })

  /* Widening these would hand the archive credential more of the bank's
     Workspace than the archive needs. */
  test('requests only Drive and Sheets', () => {
    const { claims } = parts(assertion())
    assert.deepEqual(claims.scope.split(' ').sort(), [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ])
  })

  /* sub would make this domain-wide delegation — the account impersonating a
     user. Access is meant to come from the Shared Drive grant (§4.4). */
  test('does not request impersonation', () => {
    const { claims } = parts(assertion())
    assert.equal(claims.sub, undefined)
  })

  test('segments are base64url — no +, / or = padding', () => {
    assert.doesNotMatch(assertion(), /[+/=]/)
  })
})
