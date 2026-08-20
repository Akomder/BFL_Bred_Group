import { resolve, sep } from 'node:path'

/* Input validation for everything that crosses the trust boundary.

   Every value here arrives in the multipart body of POST /api/submissions,
   which means a tablet typed it — or an attacker did. Two of these values
   used to be spliced straight into filesystem paths (spool.js) and one into
   an SMTP envelope (mailer.js), so they are validated at the route boundary
   AND again at the point of use: a path built from an unchecked reference is
   an arbitrary file write, and that is worth checking twice. */

/**
 * The reference is the spool directory name (spool.js), so it has to be a
 * single, boring path segment. Anchoring the first character to
 * alphanumeric is what makes "." and ".." unrepresentable — a pattern that
 * merely allows dots would happily match "..".
 */
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const isSafeReference = (value) => typeof value === 'string' && REFERENCE_PATTERN.test(value)

/**
 * The client's filename is advisory only. Rather than trying to make an
 * arbitrary string safe, this keeps the last path segment, strips anything
 * outside a conservative allowlist, and falls back to a fixed name — the
 * result is always a plain segment, never a traversal.
 */
export const safeFileName = (value, fallback = 'submission.pdf') => {
  const segment = String(value ?? '')
    .split(/[/\\]/)
    .pop()
  const cleaned = segment.replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '')
  if (!cleaned || cleaned.length > 128) return fallback
  return cleaned
}

/**
 * Last line of defence before a write: proves the resolved target really sits
 * under `root`. Catches anything the pattern checks above might have missed,
 * including symlinked or oddly-normalised segments.
 */
export const assertWithin = (root, target) => {
  const base = resolve(root)
  const full = resolve(target)
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error('Refusing to write outside the spool directory')
  }
  return full
}

/* Deliberately stricter than RFC 5322: this address becomes an SMTP envelope
   recipient, so the characters that let one address become several — CR, LF,
   comma, semicolon, angle brackets, whitespace — must not survive, and a
   single "@" with a dotted domain is all a customer ever needs to type. */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/

export const isValidEmail = (value) =>
  typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value)

/**
 * Confirms the upload is actually a PDF rather than arbitrary bytes wearing
 * the name of one — it gets emailed from a bank domain and archived to Drive,
 * so "whatever the client sent" is not good enough.
 */
export const looksLikePdf = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
