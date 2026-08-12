import { config } from './config.js'
import { GRAPH, getGraphToken } from './graph.js'

/**
 * Archives the PDF to SharePoint through Microsoft Graph. Forms are filed under
 * <folder>/<YYYY>/<MM>/ so a branch can find a day's slips quickly.
 *
 * Uses the simple upload endpoint, which covers files up to 4 MB — a signed
 * form with one photo sits far below that.
 *
 * Assumes SharePoint is configured — the boot preflight (preflight.js) refuses
 * to start the service otherwise, so there is no local-file fallback here.
 */
export const archiveSubmission = async ({ payload, pdf, fileName }) => {
  const submittedAt = new Date(payload.meta.submittedAt)
  const year = submittedAt.getUTCFullYear()
  const month = String(submittedAt.getUTCMonth() + 1).padStart(2, '0')
  const path = `${config.sharepoint.folder}/${year}/${month}/${fileName}`

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

/**
 * Startup check: confirms the app registration authenticates AND that
 * SP_DRIVE_ID actually points at a reachable drive. A token-only check would
 * still let a wrong drive ID through — that error would otherwise surface on
 * the branch's very first archive attempt instead of at boot.
 */
export const verifySharePoint = async () => {
  const token = await getGraphToken(config.sharepoint)
  const res = await fetch(`${GRAPH}/drives/${config.sharepoint.driveId}/root`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`SharePoint drive unreachable: ${res.status} ${await res.text()}`)
  return true
}
