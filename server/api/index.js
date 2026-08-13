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
 * Also note: OUTBOX_DIR must point at /tmp (e.g. OUTBOX_DIR=/tmp/outbox) in
 * this environment's variables — a Vercel function's working directory is
 * read-only; only /tmp is writable, and only for the lifetime of that
 * invocation's container.
 */
export default createApp()
