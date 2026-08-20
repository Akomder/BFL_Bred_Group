import { timingSafeEqual, createHash } from 'node:crypto'
import { config } from './config.js'

/* CORS is not access control — it is enforced by browsers and by nothing else,
   so it never stopped a script from posting a forged form, draining the spool
   or relaying mail through the branch's SMTP account. These are the actual
   credential checks.

   Two tiers, because the tablets and whoever is on support need very
   different things: a device key submits forms, an admin key inspects and
   flushes the spool. A tablet key deliberately cannot do the second. */

/**
 * Compares over a hash so the comparison is constant-time regardless of the
 * two lengths — timingSafeEqual throws on a length mismatch, and reaching
 * that throw is itself a length oracle.
 */
const secureEquals = (a, b) => {
  const digest = (value) => createHash('sha256').update(String(value)).digest()
  return timingSafeEqual(digest(a), digest(b))
}

/** Bearer token, or the X-API-Key header the tablets find easier to set. */
const presentedKey = (req) => {
  const header = req.get('authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return req.get('x-api-key')?.trim() ?? ''
}

/**
 * Fails closed. An unconfigured key list means nobody gets in, rather than
 * everybody — a deployment that forgot to set API_KEYS is a misconfiguration,
 * and the safe reading of a misconfiguration on a banking endpoint is "deny".
 * The VPS preflight refuses to boot in this state; on Vercel, where there is
 * no preflight (see api/index.js), this 503 is what holds the line.
 */
export const requireKey = (keysFor, label) => (req, res, next) => {
  const allowed = keysFor()

  if (allowed.length === 0) {
    console.error(`[auth] ${req.method} ${req.path} refused — no ${label} configured`)
    return res.status(503).json({ error: 'Service is not configured to accept requests' })
  }

  const presented = presentedKey(req)
  if (presented && allowed.some((key) => secureEquals(key, presented))) return next()

  // No detail about which part failed, and never the presented value.
  console.warn(`[auth] rejected ${req.method} ${req.path}`)
  return res.status(401).json({ error: 'Unauthorized' })
}

/** Tablets: submitting a form and asking for their own address. */
export const requireDeviceKey = requireKey(() => config.auth.deviceKeys, 'API_KEYS')

/** Support/IT: reading the spool, flushing it, full health detail. */
export const requireAdminKey = requireKey(() => config.auth.adminKeys, 'ADMIN_API_KEYS')

/** True when the caller holds a valid admin key — for routes that answer
 *  both authenticated and anonymous callers with different detail. */
export const hasAdminKey = (req) => {
  const presented = presentedKey(req)
  return Boolean(presented) && config.auth.adminKeys.some((key) => secureEquals(key, presented))
}
