import { parseList, isAllowed } from './server/src/allowlist.js'

/**
 * Source-IP allowlist at the edge — the layer nginx used to hold
 * (deploy.md §9.1), reimplemented for the serverless deployment.
 *
 * This is not defence in depth for its own sake. VITE_API_KEY is inlined into
 * the built bundle by design (web/.env.example says so), which means anyone
 * who can load the tablet UI can read the device key out of the JavaScript.
 * On a branch LAN behind nginx that was tolerable precisely because the
 * allowlist stood in front of it. On a public deployment, without this file,
 * that key is world-readable and every /api/ route is reachable by anyone who
 * views source — forged deposit records included.
 *
 * Runs before the function, so blocked traffic never reaches Node and never
 * costs an invocation.
 *
 *   /api/spool, /api/spool/flush  ->  ADMIN_CIDRS   (IT administration only)
 *   everything else under /api/   ->  ALLOWED_CIDRS (branch + VPN egress)
 *   /  (the static tablet UI)     ->  open, per §9.1: locking it down would
 *                                     break nothing but protect nothing
 *
 * Fails closed — see isAllowed() in server/src/allowlist.js.
 *
 * If branch egress addresses are dynamic, do NOT widen these to 0.0.0.0/0 and
 * rely on the device key alone — deploy.md §9.1 rules that out explicitly.
 * Use a site-to-site VPN, an identity-aware proxy, or Vercel Firewall rules,
 * and record the decision.
 */

export const config = { matcher: '/api/:path*' }

/**
 * Vercel sets x-vercel-forwarded-for from the real connection and overwrites
 * whatever the caller sent, so it is the one forwarded header here that a
 * client cannot choose. x-forwarded-for is deliberately not consulted: it is
 * the header an attacker would set to bypass this file.
 */
const clientIp = (request) => (request.headers.get('x-vercel-forwarded-for') ?? '').split(',')[0].trim()

export default function middleware(request) {
  const { pathname } = new URL(request.url)

  const admin = pathname === '/api/spool' || pathname.startsWith('/api/spool/')
  const source = admin ? 'ADMIN_CIDRS' : 'ALLOWED_CIDRS'
  const entries = parseList(process.env[source])

  if (isAllowed(clientIp(request), entries)) return undefined // falls through to api/index.js

  if (entries.length === 0) {
    console.error(`[allowlist] ${request.method} ${pathname} refused — ${source} is not set`)
  } else {
    console.warn(`[allowlist] rejected ${request.method} ${pathname}`)
  }

  // Same shape as auth.js's rejections: no detail about which layer failed.
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}
