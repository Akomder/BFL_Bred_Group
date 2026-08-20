import { authHeaders } from './submit'

const DEVICE_KEY = 'bfl.deviceId'
const BRANCH_KEY = 'bfl.branch'

/**
 * Branches a tablet can be registered to. Replace with the real branch list —
 * or fetch it from the core system — when the branch codes are confirmed.
 */
export const BRANCHES = [
  'Head Office — Vientiane Capital',
  'Mixay Branch — Vientiane Capital',
  '103 Hospital Branch — Vientiane Capital',
  'Itec Branch — Vientiane Capital',
  'Wattay Branch — Vientiane Capital',
  'Luang Prabang Branch — Luang Prabang Province',
  'Pakse Branch — Champasak Province',
  'Savannakhet Branch — Savannakhet Province',
  'Vangvieng Branch — Vientiane Province',
]

/**
 * Stable per-tablet identifier. Generated once and kept in localStorage, so it
 * survives reloads and identifies the device on every form it produces.
 */
export const getDeviceId = (): string => {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const uuid = crypto.randomUUID()
    id = `TAB-${uuid.slice(0, 8).toUpperCase()}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export const getBranch = (): string => localStorage.getItem(BRANCH_KEY) ?? BRANCHES[0]

export const setBranch = (branch: string): void => localStorage.setItem(BRANCH_KEY, branch)

export const isBranchRegistered = (): boolean => localStorage.getItem(BRANCH_KEY) !== null

/**
 * The client IP is only trustworthy when the server reports it, so the app
 * asks the backend for it rather than reading it from the browser.
 */
export const fetchClientIp = async (apiBase: string | undefined): Promise<string> => {
  if (!apiBase) return 'Not available'
  try {
    const res = await fetch(`${apiBase}/api/client-ip`, { headers: authHeaders() })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { ip?: string }
    return data.ip ?? 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * Reference shown to the customer, filed under in the PDF/email/ledger, and
 * used as the archived filename. No separators — one continuous token. Unique
 * down to the second (date+time to the second) plus 6 random hex characters,
 * so two tablets at different branches submitting in the same second still
 * can't collide in practice: a 4-digit random suffix on date-only (the
 * previous scheme) had a real birthday-paradox collision risk once a branch
 * did more than a couple hundred submissions in a day.
 */
export const makeReference = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const unique = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  return `BFL${stamp}${unique}`
}
