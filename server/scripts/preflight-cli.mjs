import { assertReady } from '../src/preflight.js'
import { resetSmtpTransport } from '../src/mail/smtpSend.js'

/**
 * Runs the boot preflight as a standalone check, so it can gate something
 * other than a boot.
 *
 * The serverless entry point (api/index.js) cannot run assertReady() the way
 * server/src/index.js does — there is no process to refuse to start. This
 * script is where that guarantee goes instead: Vercel's build command calls
 * it, so a deployment whose SMTP or Drive credentials are rejected fails the
 * build and never becomes the live deployment.
 *
 * Exits 0 when mail and Drive both verify, 1 when either is rejected or the
 * configuration is incomplete. preflight.js has already logged which.
 */
try {
  const verified = await assertReady()
  console.log('preflight OK')
  console.log(`  mail    -> verified`)
  console.log(`  archive -> Google Drive (verified)`)
  console.log(`  sheets  -> ${verified.sheets}`)
} catch {
  // preflight.js logged exactly what failed and why. Closing the SMTP pool
  // lets Node drain and exit on its own rather than being torn down with
  // sockets mid-close — same reasoning as server/src/index.js.
  console.error('preflight FAILED — refusing to build this deployment.')
  process.exitCode = 1
}

resetSmtpTransport()
