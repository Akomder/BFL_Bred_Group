import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.js'
import { assertWithin, isSafeReference, safeFileName } from './validate.js'

/* The customer is told to wait for the teller the moment they submit, and the
   PDF only ever existed in their browser. So a form that cannot be emailed is
   written to disk rather than lost, and IT drains the backlog later through
   /api/spool/flush. */

const spoolRoot = () => join(config.outbox, 'spool')

/**
 * The reference comes from the request body, so it is checked again here
 * rather than trusted from the route: this function is what turns it into a
 * filesystem path, and an unchecked "../.." at this point is an arbitrary
 * file write, not a bad directory name. `assertWithin` then proves the
 * result really did stay under the spool root.
 */
const dirFor = (referenceNo) => {
  if (!isSafeReference(referenceNo)) throw new Error(`Unsafe spool reference: ${JSON.stringify(referenceNo)}`)
  return assertWithin(spoolRoot(), join(spoolRoot(), referenceNo))
}

/**
 * Writes an undeliverable submission to the spool: the PDF beside a manifest
 * with everything needed to send it later without the browser being involved.
 */
export const spool = async ({ payload, pdf, fileName }, reason) => {
  const dir = dirFor(payload.meta.referenceNo)
  // Same reasoning as the reference above: the filename reached us from the
  // upload, so it is reduced to a plain segment before it becomes a path.
  const safeName = safeFileName(fileName, `${payload.meta.referenceNo}.pdf`)

  await mkdir(dir, { recursive: true })
  await writeFile(assertWithin(dir, join(dir, safeName)), pdf)
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ payload, fileName: safeName, reason, spooledAt: new Date().toISOString() }, null, 2),
  )
  return { spooled: true, path: dir }
}

/** What is waiting to go out, newest first. */
export const listSpool = async () => {
  let entries
  try {
    entries = await readdir(spoolRoot(), { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(await readFile(join(dirFor(entry.name), 'manifest.json'), 'utf8'))
      items.push({
        referenceNo: entry.name,
        fileName: manifest.fileName,
        reason: manifest.reason,
        spooledAt: manifest.spooledAt,
      })
    } catch {
      // A half-written directory should not hide the rest of the backlog.
      items.push({ referenceNo: entry.name, unreadable: true })
    }
  }
  return items.sort((a, b) => String(b.spooledAt).localeCompare(String(a.spooledAt)))
}

/**
 * Re-attempts every spooled submission with `send`. Delivered items move to
 * `outbox/sent/` rather than being deleted — an operator should be able to see
 * what went out after an outage.
 */
export const flushSpool = async (send) => {
  const results = []

  for (const item of await listSpool()) {
    if (item.unreadable) {
      results.push({ referenceNo: item.referenceNo, delivered: false, error: 'unreadable manifest' })
      continue
    }

    try {
      // Inside the try: dirFor rejects an unsafe directory name, and one bad
      // entry must not abort the flush for every other queued form.
      const dir = dirFor(item.referenceNo)
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      /* A manifest spooled before filenames were validated could still name a
         traversal path, so it is reduced on the way back in as well. */
      const fileName = safeFileName(manifest.fileName, `${item.referenceNo}.pdf`)
      const pdf = await readFile(assertWithin(dir, join(dir, fileName)))
      const result = await send({ payload: manifest.payload, pdf, fileName })

      if (!result.delivered) {
        results.push({ referenceNo: item.referenceNo, delivered: false, error: result.reason })
        continue
      }

      const sentDir = join(config.outbox, 'sent')
      await mkdir(sentDir, { recursive: true })
      await rename(dir, assertWithin(sentDir, join(sentDir, item.referenceNo)))
      results.push({ referenceNo: item.referenceNo, delivered: true, transport: result.transport })
    } catch (error) {
      results.push({ referenceNo: item.referenceNo, delivered: false, error: error.message })
    }
  }

  return results
}
