import { CURRENCY_INFO, type CurrencyCode } from './types'

/** Block sizes of a BFL account number: 3-7-2-4-2, 18 digits in total. */
export const ACCOUNT_MASK = [3, 7, 2, 4, 2]
export const ACCOUNT_LENGTH = ACCOUNT_MASK.reduce((a, b) => a + b, 0)

export const digitsOnly = (value: string): string => value.replace(/\D/g, '')

/** Splits raw digits into the mask blocks, keeping partial input intact. */
export const splitAccountNumber = (raw: string): string[] => {
  const digits = digitsOnly(raw).slice(0, ACCOUNT_LENGTH)
  const blocks: string[] = []
  let offset = 0
  for (const size of ACCOUNT_MASK) {
    blocks.push(digits.slice(offset, offset + size))
    offset += size
  }
  return blocks
}

/** "123456789..." -> "123 4567890 12 3456 78" */
export const formatAccountNumber = (raw: string): string =>
  splitAccountNumber(raw)
    .filter((block) => block.length > 0)
    .join(' ')

export const isAccountNumberComplete = (raw: string): boolean =>
  digitsOnly(raw).length === ACCOUNT_LENGTH

/**
 * Groups the integer part in threes and keeps at most the currency's decimals.
 * Works on partial input, so it can run on every keystroke: "2000000" ->
 * "2,000,000" and "1234.5" -> "1,234.5".
 */
export const formatAmount = (raw: string, currency: CurrencyCode): string => {
  const { decimals } = CURRENCY_INFO[currency]
  const cleaned = sanitizeAmount(raw, currency)
  if (cleaned === '') return ''
  const [int, dec] = cleaned.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (dec === undefined) return grouped
  return decimals > 0 ? `${grouped}.${dec}` : grouped
}

/**
 * Strips everything that is not a digit or a single decimal point, drops the
 * decimal part entirely for zero-decimal currencies, and trims extra decimals.
 */
export const sanitizeAmount = (raw: string, currency: CurrencyCode): string => {
  const { decimals } = CURRENCY_INFO[currency]
  let cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot >= 0) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  if (decimals === 0) return cleaned.split('.')[0]
  const [int, dec] = cleaned.split('.')
  if (dec === undefined) return int
  return `${int}.${dec.slice(0, decimals)}`
}

export const parseAmount = (raw: string): number => {
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
}

/** Amount with grouping and the currency's fixed decimals, for review and PDF. */
export const formatAmountForDisplay = (raw: string, currency: CurrencyCode): string => {
  const { decimals } = CURRENCY_INFO[currency]
  const value = parseAmount(raw)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export const formatDateTime = (iso: string): string => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Deliberately permissive: staff phone numbers are free text per the spec. */
export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
