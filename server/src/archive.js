import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, isSharePointConfigured } from './config.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'

const getToken = async () => {
  const { tenantId, clientId, clientSecret } = config.sharepoint
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) throw new Error(`Graph token failed: ${res.status} ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token
}

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

  const token = await getToken()
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
