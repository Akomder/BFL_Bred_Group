/**
 * Source-IP allowlist matching — the arithmetic behind middleware.js, kept
 * here so it sits with the other security primitives (validate.js, auth.js)
 * and is covered by the server test suite.
 *
 * Deliberately dependency-free and free of Node built-ins: middleware.js runs
 * on the edge runtime, and this module is bundled into it.
 */

/** Splits a comma-separated env var into entries, dropping blanks. */
export const parseList = (value) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

/**
 * Parses an address to a bigint plus its bit width, so v4 and v6 can be
 * compared by the same prefix arithmetic. Returns null on anything
 * unparseable — callers treat that as "no match", never as "allow".
 */
const toBits = (address) => {
  const value = String(address ?? '').trim().toLowerCase()

  // ::ffff:1.2.3.4 is an IPv4 client arriving over a v6 socket. Normalise it,
  // so an operator can write plain v4 CIDRs and have them work either way.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  const plain = mapped ? mapped[1] : value

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(plain)) {
    const octets = plain.split('.').map(Number)
    if (octets.some((octet) => octet > 255)) return null
    return { bits: octets.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n), width: 32 }
  }

  if (!value.includes(':')) return null

  // Expand the :: run, then require exactly eight 16-bit groups.
  const [head, tail, ...rest] = value.split('::')
  if (rest.length > 0) return null
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const missing = 8 - headGroups.length - tailGroups.length
  if (value.includes('::') ? missing < 0 : missing !== 0) return null
  const groups = value.includes('::')
    ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    : headGroups

  let bits = 0n
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    bits = (bits << 16n) | BigInt(parseInt(group, 16))
  }
  return { bits, width: 128 }
}

/** True when `address` falls inside `entry`, which may be a CIDR or a bare address. */
export const matches = (address, entry) => {
  const [network, prefix] = String(entry ?? '').split('/')
  const target = toBits(address)
  const base = toBits(network)
  if (!target || !base || target.width !== base.width) return false

  const length = prefix === undefined ? base.width : Number(prefix)
  if (!/^\d+$/.test(prefix ?? '0') || !Number.isInteger(length) || length < 0 || length > base.width) return false
  if (length === 0) return true

  // Compare only the prefix: shift both down by the host bits and equate.
  const hostBits = BigInt(base.width - length)
  return target.bits >> hostBits === base.bits >> hostBits
}

/**
 * Fails closed, for the same reason auth.js does: an empty allowlist means a
 * deployment forgot to configure one, and the safe reading of a
 * misconfiguration on a banking endpoint is "deny", not "allow everyone".
 */
export const isAllowed = (address, entries) =>
  entries.length > 0 && Boolean(address) && entries.some((entry) => matches(address, entry))
