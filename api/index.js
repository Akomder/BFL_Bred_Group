import { createApp } from '../server/src/app.js'

/**
 * Vercel entry point. Deliberately does NOT call assertReady()
 * (server/src/preflight.js) — that function throws to stop a boot sequence,
 * and index.js turns that into a non-zero exit. Refusing to come up at all is
 * the correct answer for a persistent VPS process; inside a serverless
 * invocation it just kills one request and the next one starts over, so it
 * protects nothing here.
 *
 * That check is not simply dropped, because "never accept a form we cannot
 * deliver or archive" is the reason it exists. It moves to the two moments a
 * serverless deployment actually has:
 *
 *   - Deploy time — `npm run preflight` runs in the Vercel build command
 *     (vercel.json), so credentials that Drive or the SMTP relay reject fail
 *     the build instead of going live. See server/scripts/preflight-cli.mjs.
 *   - Request time — auth.js fails closed: with API_KEYS or ADMIN_API_KEYS
 *     unset every endpoint answers 503 rather than serving anonymous callers,
 *     and GET /api/health reports live status to an admin key on demand.
 *
 * What that still does not cover is a credential accepted at build time and
 * revoked afterwards. Watch /api/health/detail rather than assuming a
 * successful deploy stays valid.
 *
 * Two environment variables matter here specifically, beyond the ones in
 * server/.env.example:
 *
 *   TRUST_PROXY=1  — this always runs behind Vercel's proxy. Left at the
 *     default of 0, req.ip is that proxy for every caller: the IP written
 *     into the audit mail, the ledger and the customer's PDF is then the same
 *     wrong value every time, and per-IP rate limiting collapses into a
 *     single shared bucket.
 *   SPOOL_DRIVER=blob — this filesystem is read-only apart from /tmp, and
 *     /tmp dies with the container. See server/src/spool.js.
 *
 * Note also that the in-memory rate limiter counts per instance, so the
 * effective ceiling across a scaled-out deployment is higher than configured.
 * The source-IP allowlist in middleware.js is what actually bounds who can
 * reach these routes.
 */
export default createApp()
