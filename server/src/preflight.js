import { configProblems, isSheetsConfigured } from './config.js'
import { verifyMailConfig } from './mailer.js'
import { verifyDrive } from './drive.js'
import { verifySheetsConfig } from './sheets.js'

/**
 * Logs the reason and throws, which is what actually stops the boot sequence
 * — index.js's `main()` never reaches `express()`/`app.listen()` because the
 * `await assertReady()` that called this rejects before returning. The process
 * exit itself is handled once, at the top of index.js, after this has
 * unwound — see the comment there for why it isn't done here.
 */
const fatal = (title, lines) => {
  console.error(`\nFATAL: ${title}\n`)
  for (const line of lines) console.error(`  - ${line}`)
  console.error('\nSee server/.env.example and the README before starting this service.\n')
  throw new Error(title)
}

/**
 * Refuses to let the service come up misconfigured. A branch counter must
 * never accept a form it cannot actually deliver or archive — that failure
 * needs to be loud and immediate, not discovered from a growing spool at
 * end of day. Runs once at boot, before the server starts listening.
 *
 * The Google Sheets ledger is deliberately exempt: it's a bonus, not the
 * operational requirement, so it degrades to "skipped" rather than blocking
 * the service (see sheets.js).
 */
export const assertReady = async () => {
  const missing = configProblems()
  if (missing.length) fatal('production configuration is incomplete.', missing)

  const mail = await verifyMailConfig()
  const mailFailures = Object.entries(mail)
    .filter(([, status]) => status !== 'ok')
    .map(([name, status]) => `mail (${name}): ${status}`)

  let drive = 'ok'
  try {
    await verifyDrive()
  } catch (error) {
    drive = `FAILED — ${error.message}`
  }

  const failures = [...mailFailures, ...(drive !== 'ok' ? [`drive: ${drive}`] : [])]
  if (failures.length) fatal('configured credentials were rejected.', failures)

  let sheets = 'not configured — skipping'
  if (isSheetsConfigured()) {
    try {
      await verifySheetsConfig()
      sheets = 'ok'
    } catch (error) {
      // Optional, so this never blocks boot — just says so loudly in the log.
      sheets = `FAILED — ${error.message}`
    }
  }

  return { mail, drive, sheets }
}
