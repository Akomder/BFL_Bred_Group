import { CURRENCY_INFO, type CurrencyCode } from './types'
import { parseAmount } from './format'

/* ------------------------------------------------------------------ English */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', ' thousand', ' million', ' billion', ' trillion']

const belowThousandEn = (n: number): string => {
  if (n < 20) return ONES[n]
  if (n < 100) {
    const rest = n % 10
    return TENS[Math.floor(n / 10)] + (rest ? `-${ONES[rest]}` : '')
  }
  const rest = n % 100
  return `${ONES[Math.floor(n / 100)]} hundred` + (rest ? ` ${belowThousandEn(rest)}` : '')
}

/** 1234 -> "one thousand two hundred thirty-four" */
export const numberToWordsEn = (value: number): string => {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'zero'
  const chunks: string[] = []
  let rest = n
  let scale = 0
  while (rest > 0 && scale < SCALES.length) {
    const chunk = rest % 1000
    if (chunk > 0) chunks.unshift(belowThousandEn(chunk) + SCALES[scale])
    rest = Math.floor(rest / 1000)
    scale += 1
  }
  return chunks.join(' ')
}

/** Currency names that never take an "s" in the plural. */
const INVARIANT_EN = new Set(['Lao Kip', 'Thai Baht', 'Satang', 'Att'])

const pluralEn = (unit: string, count: number): string =>
  count === 1 || INVARIANT_EN.has(unit) ? unit : `${unit}s`

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/* ---------------------------------------------------------------------- Lao */

const LAO_DIGITS = ['ສູນ', 'ໜຶ່ງ', 'ສອງ', 'ສາມ', 'ສີ່', 'ຫ້າ', 'ຫົກ', 'ເຈັດ', 'ແປດ', 'ເກົ້າ']
/** Place values inside one six-digit group, most significant first. */
const LAO_PLACES = ['ແສນ', 'ໝື່ນ', 'ພັນ', 'ຮ້ອຍ', 'ສິບ', '']

const belowMillionLo = (n: number): string => {
  if (n === 0) return ''
  const padded = String(n).padStart(6, '0')
  let out = ''
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(padded[i])
    if (digit === 0) continue
    const place = LAO_PLACES[i]
    const isTens = i === 4
    const isUnits = i === 5
    const tensDigit = Number(padded[4])
    if (isTens) {
      // 10 is ສິບ (never ໜຶ່ງສິບ) and 20 is ຊາວ (never ສອງສິບ).
      if (digit === 1) out += 'ສິບ'
      else if (digit === 2) out += 'ຊາວ'
      else out += LAO_DIGITS[digit] + 'ສິບ'
      continue
    }
    if (isUnits && digit === 1 && tensDigit > 0) {
      // A trailing 1 after any tens becomes ເອັດ: 11 ສິບເອັດ, 21 ຊາວເອັດ.
      out += 'ເອັດ'
      continue
    }
    out += LAO_DIGITS[digit] + place
  }
  return out
}

/** 1234 -> "ໜຶ່ງພັນສອງຮ້ອຍສາມສິບສີ່" */
export const numberToWordsLo = (value: number): string => {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return LAO_DIGITS[0]
  if (n < 1_000_000) return belowMillionLo(n)
  const millions = Math.floor(n / 1_000_000)
  const rest = n % 1_000_000
  return `${numberToWordsLo(millions)}ລ້ານ${belowMillionLo(rest)}`
}

/* ------------------------------------------------------------------ Amounts */

const splitMinor = (value: number, decimals: number): [number, number] => {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor)
  return [Math.floor(rounded / factor), rounded % factor]
}

/**
 * "Two thousand Lao Kip only" — the wording that appears on the review screen
 * and, alongside the figures, on the PDF.
 */
export const amountInWordsEn = (raw: string | number, currency: CurrencyCode): string => {
  const info = CURRENCY_INFO[currency]
  const value = typeof raw === 'number' ? raw : parseAmount(raw)
  const [major, minor] = splitMinor(value, info.decimals)
  const parts = [`${numberToWordsEn(major)} ${pluralEn(info.majorEn, major)}`]
  if (minor > 0) parts.push(`${numberToWordsEn(minor)} ${pluralEn(info.minorEn, minor)}`)
  return `${capitalise(parts.join(' and '))} only`
}

/** Lao equivalent, e.g. "ສອງພັນກີບຖ້ວນ". */
export const amountInWordsLo = (raw: string | number, currency: CurrencyCode): string => {
  const info = CURRENCY_INFO[currency]
  const value = typeof raw === 'number' ? raw : parseAmount(raw)
  const [major, minor] = splitMinor(value, info.decimals)
  let out = `${numberToWordsLo(major)}${info.majorLo}`
  if (minor > 0) out += `${numberToWordsLo(minor)}${info.minorLo}`
  return `${out}ຖ້ວນ`
}
