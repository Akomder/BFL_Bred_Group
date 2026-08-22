import { put, list, del, head } from '@vercel/blob'
import { isSafeReference, safeFileName } from '../validate.js'

/* Vercel Blob spool driver — the durable backing store for the serverless
   deployment, where the filesystem the fs driver relies on does not survive
   the invocation that wrote it.
                                                                          
   The guarantee this has to preserve is the whole reason the spool exists: a
   form the customer already submitted, and already walked away from, must
   still be recoverable after the container that accepted it is gone. Blob
   storage is the only writable thing here that outlives the request.
                                                                          
   Layout mirrors the fs driver exactly, so an operator reading /api/spool
   sees the same shape either way:
                                                                          
     spool/<referenceNo>/<fileName>      the PDF
     spool/<referenceNo>/manifest.json   payload, filename, reason, timestamp
     sent/<referenceNo>/...              moved here once delivered
*/

const SPOOL = 'spool'
const SENT = 'sent'

/**
 * The reference reaches us from the request body and becomes part of a blob
 * key, so it is validated here rather than trusted from the route — the same
 * reasoning as the fs driver's dirFor(). A key is not a filesystem path, so
 * `..` cannot escape a directory, but an unchecked value could still collide
 * with or overwrite another reference's prefix. Reject it instead.
 */
const prefixFor = (root, referenceNo) => {
  if (!isSafeReference(referenceNo)) throw new Error(`Unsafe spool reference: ${JSON.stringify(referenceNo)}`)
  return `${root}/${referenceNo}`
}

/* Blob keys are public-by-URL but unguessable; the store itself is private to
   the project token. addRandomSuffix would make the key unpredictable and so
   unreadable on the way back out, which is exactly what the flush needs to do. */
const putOptions = { access: 'public', addRandomSuffix: false, allowOverwrite: true }

/**
 * Writes an undeliverable submission to the spool: the PDF beside a manifest
 * with everything needed to send it later without the browser being involved.
 */
export const spool = async ({ payload, pdf, fileName }, reason) => {
  const prefix = prefixFor(SPOOL, payload.meta.referenceNo)
  const safeName = safeFileName(fileName, `${payload.meta.referenceNo}.pdf`)

  /* The PDF lands first. A manifest without its PDF is listed as unreadable
     and can be investigated; a PDF without a manifest is invisible to the
     flush, so it is the manifest that marks the entry complete. */
  await put(`${prefix}/${safeName}`, pdf, { ...putOptions, contentType: 'application/pdf' })
  await put(
    `${prefix}/manifest.json`,
    JSON.stringify({ payload, fileName: safeName, reason, spooledAt: new Date().toISOString() }, null, 2),
    { ...putOptions, contentType: 'application/json' },
  )

  return { spooled: true, path: `blob:${prefix}` }
}

/** What is waiting to go out, newest first. */
export const listSpool = async () => {
  /* mode: 'folded' returns one entry per <referenceNo> rather than one per
     file, which is the same granularity readdir({ withFileTypes: true })
     gives the fs driver. */
  const { folders } = await list({ prefix: `${SPOOL}/`, mode: 'folded' })

  const items = []
  for (const folder of folders ?? []) {
    // 'spool/BFL-123/' -> 'BFL-123'
    const referenceNo = folder.slice(SPOOL.length + 1).replace(/\/$/, '')
    if (!referenceNo) continue

    try {
      const manifest = JSON.parse(await readManifest(referenceNo))
      items.push({
        referenceNo,
        fileName: manifest.fileName,
        reason: manifest.reason,
        spooledAt: manifest.spooledAt,
      })
    } catch {
      // A half-written entry should not hide the rest of the backlog.
      items.push({ referenceNo, unreadable: true })
    }
  }
  return items.sort((a, b) => String(b.spooledAt).localeCompare(String(a.spooledAt)))
}

/* head() resolves a key to its URL without downloading; the content then comes
   over plain fetch, which is what the Blob SDK does internally anyway. */
const fetchBlob = async (key) => {
  const meta = await head(key)
  const res = await fetch(meta.url)
  if (!res.ok) throw new Error(`blob fetch failed (${res.status}) for ${key}`)
  return res
}

const readManifest = async (referenceNo) =>
  (await fetchBlob(`${prefixFor(SPOOL, referenceNo)}/manifest.json`)).text()

/**
 * Re-attempts every spooled submission with `send`. Delivered items move to
 * `sent/` rather than being deleted — an operator should be able to see what
 * went out after an outage.
 *
 * The fs driver moves them with a single atomic rename(). Blob storage has no
 * rename, so this is copy-then-delete: a crash between the two leaves the form
 * in both places. That is deliberate in this direction — a duplicate in `sent/`
 * is an operator noticing a form twice, whereas deleting first and failing to
 * copy would destroy the record this whole module exists to protect.
 */
export const flushSpool = async (send) => {
  const results = []

  for (const item of await listSpool()) {
    if (item.unreadable) {
      results.push({ referenceNo: item.referenceNo, delivered: false, error: 'unreadable manifest' })
      continue
    }

    try {
      // Inside the try: prefixFor rejects an unsafe reference, and one bad
      // entry must not abort the flush for every other queued form.
      const spoolPrefix = prefixFor(SPOOL, item.referenceNo)
      const manifest = JSON.parse(await readManifest(item.referenceNo))
      /* A manifest spooled before filenames were validated could still name a
         traversal path, so it is reduced on the way back in as well. */
      const fileName = safeFileName(manifest.fileName, `${item.referenceNo}.pdf`)
      const pdf = Buffer.from(await (await fetchBlob(`${spoolPrefix}/${fileName}`)).arrayBuffer())
      const result = await send({ payload: manifest.payload, pdf, fileName })

      if (!result.delivered) {
        results.push({ referenceNo: item.referenceNo, delivered: false, error: result.reason })
        continue
      }

      const sentPrefix = prefixFor(SENT, item.referenceNo)
      await put(`${sentPrefix}/${fileName}`, pdf, { ...putOptions, contentType: 'application/pdf' })
      await put(`${sentPrefix}/manifest.json`, JSON.stringify({ ...manifest, sentAt: new Date().toISOString() }, null, 2), {
        ...putOptions,
        contentType: 'application/json',
      })
      await del([`${spoolPrefix}/${fileName}`, `${spoolPrefix}/manifest.json`])

      results.push({ referenceNo: item.referenceNo, delivered: true, transport: result.transport })
    } catch (error) {
      results.push({ referenceNo: item.referenceNo, delivered: false, error: error.message })
    }
  }

  return results
}
