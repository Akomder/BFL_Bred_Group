import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, isSharePointConfigured } from './config.js'
import { GRAPH, getGraphToken } from './graph.js'

/**
 * Archives the PDF to SharePoint through Microsoft Graph. Forms are filed under
 * <folder>/<YYYY>/<MM>/ so a branch can find a day's slips quickly.
 *
 * Uses the simple upload endpoint, which covers files up to 4 MB — a signed
 * form with one photo sits far below that.
 */
export const archiveSubmission = async ({ payload, pdf, fileName }) => {
  const submittedAt = new Date(payload.meta.submittedAt)
  const year = submittedAt.getUTCFullYear()
  const month = String(submittedAt.getUTCMonth() + 1).padStart(2, '0')
  const path = `${config.sharepoint.folder}/${year}/${month}/${fileName}`

  if (!isSharePointConfigured()) {
    const dir = join(config.outbox, payload.meta.referenceNo, 'sharepoint')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, fileName), pdf)
    console.log(`[archive] SharePoint not configured — wrote ${dir}/${fileName} (target: ${path})`)
    return { archived: false, path }
  }

  const token = await getGraphToken(config.sharepoint)
  const res = await fetch(
    `${GRAPH}/drives/${config.sharepoint.driveId}/root:/${encodeURI(path)}:/content`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' },
      body: pdf,
    },
  )
  if (!res.ok) throw new Error(`SharePoint upload failed: ${res.status} ${await res.text()}`)

  console.log(`[archive] uploaded ${path}`)
  return { archived: true, path }
}
