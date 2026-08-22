import { config, mailTransports } from './config.js'
import { createApp } from './app.js'
import { listSpool } from './spool.js'
import { assertReady } from './preflight.js'
import { resetSmtpTransport } from './mail/smtpSend.js'

/**
 * The service entry point.
 *
 * Everything lives inside main() so a preflight failure genuinely stops here
 * — `await assertReady()` rejecting means app.listen() below never runs,
 * full stop, rather than relying on a delayed process.exit() to catch up
 * before it does.
 */
async function main() {
  // Refuses to serve traffic on bad or missing production config — see
  // preflight.js. A rejection here is caught below and is the only way this
  // function exits early.
  const verified = await assertReady()

  const app = createApp()

  app.listen(config.port, async () => {
    console.log(`BFL cash form service listening on :${config.port}`)
    console.log(`  mail    -> ${mailTransports().join(' then ')} (verified)`)
    console.log('  archive -> Google Drive (verified)')
    console.log(`  sheets  -> ${verified.sheets}`)
    console.log(`  forms are always sent to ${config.mail.to}`)

    const pending = await listSpool()
    if (pending.length > 0) {
      console.warn(`  ${pending.length} form(s) waiting in the spool — POST /api/spool/flush to send them`)
    }
  })
}

main().catch(() => {
  // preflight.js already logged exactly what failed and why; this is purely
  // about exiting cleanly. The checks above can leave sockets (a pooled SMTP
  // connection, a keep-alive fetch to Graph) mid-close — forcing process.exit()
  // on top of that crashes libuv on Windows. Closing the pool and setting
  // exitCode lets Node drain and exit on its own once those sockets finish
  // closing, instead of tearing them down mid-flight.
  resetSmtpTransport()
  process.exitCode = 1
})
