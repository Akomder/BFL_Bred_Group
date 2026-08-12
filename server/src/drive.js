import { config } from './config.js'
import { getGoogleToken } from './google.js'

const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const BOUNDARY = 'bfl-cash-form-boundary'

/**
 * Builds the multipart/related body Drive's simple-upload endpoint expects:
 * a JSON metadata part (name, parent folder) followed by the PDF bytes.
 * Pure — no network — so it's directly testable.
 */
export const buildMultipartBody = ({ fileName, pdf }) => {
  const metadata = JSON.stringify({ name: fileName, parents: [config.google.drive.folderId] })
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${BOUNDARY}\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    pdf,
    Buffer.from(`\r\n--${BOUNDARY}--`),
  ])
}

/**
 * Archives the PDF to Google Drive, in the single folder GOOGLE_DRIVE_FOLDER_ID
 * points at. No year/month subfolder structure — the reference number is
 * already in the filename (CashDeposit-BFL-<date>-<seq>.pdf), and Drive's own
 * search covers the rest without the extra round trips creating subfolders
 * would cost.
 *
 * Assumes Drive is configured — the boot preflight (preflight.js) refuses to
 * start the service otherwise, so there is no local-file fallback here.
 */
export const archiveSubmission = async ({ fileName, pdf }) => {
  const token = await getGoogleToken()
  const res = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${BOUNDARY}`,
    },
    body: buildMultipartBody({ fileName, pdf }),
    signal: AbortSignal.timeout(config.google.timeoutMs),
  })

  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`)
  const { id, webViewLink } = await res.json()

  console.log(`[drive] uploaded ${fileName} -> ${id}`)
  return { archived: true, path: webViewLink ?? id }
}

/**
 * Startup check: confirms the OAuth authorization is valid AND that
 * GOOGLE_DRIVE_FOLDER_ID actually points at a folder it can see — a token-only
 * check would still let a wrong folder ID through, and that mistake would
 * otherwise surface on the branch's first real submission.
 */
export const verifyDrive = async () => {
  const token = await getGoogleToken()
  const res = await fetch(`${DRIVE_API}/${config.google.drive.folderId}?fields=id,name`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(config.google.timeoutMs),
  })
  if (!res.ok) throw new Error(`Drive folder unreachable: ${res.status} ${await res.text()}`)
  return true
}
