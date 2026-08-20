import { createApp } from '../src/app.js'

/**
 * Vercel entry point. Deliberately does NOT call assertReady() (preflight.js)
 * — that function calls process.exit() on bad config, which is correct for a
 * persistent VPS process (refuse to come up at all) but would abruptly kill
 * a serverless invocation instead. Misconfiguration here is still visible:
 * every route already handles its own failures (mail spools, archive errors
 * are caught per-request), and GET /api/health reports live status on
 * demand without needing a boot-time check.
 *
 * Because that preflight is skipped, the auth layer's fail-closed behaviour
 * is what protects this deployment: a missing API_KEYS/ADMIN_API_KEYS here
 * makes every endpoint answer 503 rather than serving anonymous callers
 * (see auth.js). Set both in the environment variables alongside the ones
 * below. Note also that the in-memory rate limiter counts per instance, so
 * the effective ceiling across a scaled-out deployment is higher than
 * configured — put an edge/WAF limit in front if this is public.
 *
 * Also note: OUTBOX_DIR must point at /tmp (e.g. OUTBOX_DIR=/tmp/outbox) in
 * this environment's variables — a Vercel function's working directory is
 * read-only; only /tmp is writable, and only for the lifetime of that
 * invocation's container.
 */
export default createApp()
