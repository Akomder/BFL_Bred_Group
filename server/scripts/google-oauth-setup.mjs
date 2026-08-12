#!/usr/bin/env node
// One-time interactive setup: mints a Google OAuth refresh token and saves it
// to server/.env, so the running service acts as your own Google account
// rather than a service account — service accounts have no Drive storage of
// their own outside a paid Workspace Shared Drive. See the README's
// "Setting up Google access" for the Cloud Console steps that come before
// this (enabling the APIs, creating a Desktop-app OAuth client).
//
// Usage: npm run google:auth
// Reads GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET from server/.env
// — fill those in first — then prints a URL to open in your browser.

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// npm run google:auth loads server/.env via --env-file-if-exists, so
// CLIENT_ID/SECRET just come from process.env — only the write-back below
// needs direct file access, to update one line in place.
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')

/** Replaces the value in place if the key already has a line, else appends
 *  it — never prints what it wrote, since a refresh token is as sensitive
 *  as a password. */
const writeEnvVar = (key, value) => {
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : []
  let found = false
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) out.push(`${key}=${value}`)
  writeFileSync(envPath, out.join('\n'))
}

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in server/.env first.')
  console.error('Create a Desktop app OAuth client at Google Cloud Console → APIs & Services →')
  console.error('Credentials → Create Credentials → OAuth client ID, then paste its values in.')
  console.error('See the README\'s "Setting up Google access".')
  process.exit(1)
}

const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']

// Desktop-app OAuth clients are allowed by Google to redirect to any
// localhost port at request time (RFC 8252) — no need to pre-register one,
// so an OS-assigned free port avoids any conflict.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.end(`Authorization failed: ${error}. You can close this tab.`)
    console.error(`\nGoogle returned an error: ${error}`)
    server.close()
    process.exitCode = 1
    return
  }
  if (!code) {
    res.end('Waiting for authorization...')
    return
  }

  res.end('Authorized — you can close this tab and go back to the terminal.')

  const port = server.address().port
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `http://localhost:${port}`,
    }),
  })

  const body = await tokenRes.json()
  server.close()

  if (!tokenRes.ok || !body.refresh_token) {
    console.error('\nToken exchange failed:', body.error_description ?? body.error ?? JSON.stringify(body))
    if (body.error !== 'invalid_grant' && !body.refresh_token) {
      console.error(
        '\nIf you have run this before, Google may not issue a fresh refresh token for the same',
        'account without re-consenting. Revoke prior access at',
        'myaccount.google.com/permissions and run this again.',
      )
    }
    process.exitCode = 1
    return
  }

  writeEnvVar('GOOGLE_OAUTH_REFRESH_TOKEN', body.refresh_token)
  console.log('\nDone. Refresh token saved to server/.env (not printed here).')
  console.log('Run `npm start` to boot the service.')
})

server.listen(0, () => {
  const port = server.address().port
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `http://localhost:${port}`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  // Forces Google to reissue a refresh token even on a repeat authorization,
  // which it otherwise sometimes skips.
  authUrl.searchParams.set('prompt', 'consent')

  console.log('\nOpen this URL, sign in with the Google account the archive should use, and approve access:\n')
  console.log(authUrl.toString())
  console.log('\nWaiting for you to finish in the browser...')
})
