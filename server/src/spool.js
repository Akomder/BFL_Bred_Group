import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.js'

/* The customer is told to wait for the teller the moment they submit, and the
   PDF only ever existed in their browser. So a form that cannot be emailed is
   written to disk rather than lost, and IT drains the backlog later through
   /api/spool/flush. */

const spoolRoot = () => join(config.outbox, 'spool')

const dirFor = (referenceNo) => join(spoolRoot(), referenceNo)

/**
 * Writes an undeliverable submission to the spool: the PDF beside a manifest
 * with everything needed to send it later without the browser being involved.
 */
export const spool = async ({ payload, pdf, fileName }, reason) => {
  const dir = dirFor(payload.meta.referenceNo)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, fileName), pdf)
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ payload, fileName, reason, spooledAt: new Date().toISOString() }, null, 2),
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

    const dir = dirFor(item.referenceNo)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
      const pdf = await readFile(join(dir, manifest.fileName))
      const result = await send({ payload: manifest.payload, pdf, fileName: manifest.fileName })

      if (!result.delivered) {
        results.push({ referenceNo: item.referenceNo, delivered: false, error: result.reason })
        continue
      }

      const sentDir = join(config.outbox, 'sent')
      await mkdir(sentDir, { recursive: true })
      await rename(dir, join(sentDir, item.referenceNo))
      results.push({ referenceNo: item.referenceNo, delivered: true, transport: result.transport })
    } catch (error) {
      results.push({ referenceNo: item.referenceNo, delivered: false, error: error.message })
    }
  }

  return results
}
