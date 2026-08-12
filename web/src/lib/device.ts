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
  'Wattay Branch - Vientiane Capital',
  'Luang Prabang Branch — Luang Prabang Province',
  'Pakse Branch — Champasak',
  'Savannakhet Branch',
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
    const res = await fetch(`${apiBase}/api/client-ip`)
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { ip?: string }
    return data.ip ?? 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/** Human-readable reference shown to the customer and used in the PDF filename. */
export const makeReference = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const rand = Math.floor(Math.random() * 10000)
  return `BFL-${stamp}-${String(rand).padStart(4, '0')}`
}
