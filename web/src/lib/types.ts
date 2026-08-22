export type TxKind = 'deposit' | 'withdrawal'

export type CurrencyCode = 'LAK' | 'USD' | 'THB' | 'EUR'

export const CURRENCIES: CurrencyCode[] = ['LAK', 'USD', 'THB', 'EUR']

export interface CurrencyInfo {
  /** The known enum code, or an arbitrary customer-typed string via "Other". */
  code: string
  /** Digits after the decimal separator used for input, display and the PDF. */
  decimals: number
  /** Major unit, e.g. "Lao Kip". */
  majorEn: string
  /** Minor unit, e.g. "Att". Empty when the currency has no minor unit in practice. */
  minorEn: string
  majorLo: string
  minorLo: string
}

/**
 * LAK is quoted without decimals in branch practice, so its minor unit is
 * intentionally unused — `decimals: 0` means it can never be reached.
 */
export const CURRENCY_INFO: Record<CurrencyCode, CurrencyInfo> = {
  LAK: { code: 'LAK', decimals: 0, majorEn: 'Lao Kip', minorEn: 'Att', majorLo: 'ກີບ', minorLo: 'ອັດ' },
  USD: { code: 'USD', decimals: 2, majorEn: 'US Dollar', minorEn: 'Cent', majorLo: 'ໂດລາສະຫະລັດ', minorLo: 'ເຊັນ' },
  THB: { code: 'THB', decimals: 2, majorEn: 'Thai Baht', minorEn: 'Satang', majorLo: 'ບາດໄທ', minorLo: 'ສະຕາງ' },
  EUR: { code: 'EUR', decimals: 2, majorEn: 'Euro', minorEn: 'Cent', majorLo: 'ເອີໂຣ', minorLo: 'ເຊັນ' },
}

/**
 * Looks up a currency's display info, falling back to treating an unrecognized
 * (customer-typed, via the "Other" option) code as a whole-unit currency with
 * no minor unit — same mechanism LAK's `decimals: 0` already relies on, so the
 * minor-unit branch in amountInWords simply never fires for it.
 */
export const getCurrencyInfo = (code: string): CurrencyInfo =>
  CURRENCY_INFO[code as CurrencyCode] ?? {
    code,
    decimals: 0,
    majorEn: code,
    minorEn: '',
    majorLo: code,
    minorLo: '',
  }

export interface FormData {
  kind: TxKind
  accountName: string
  /** Digits only; the 3-7-2-4-2 grouping is presentation. */
  accountNumber: string
  /** A known CurrencyCode, or an arbitrary customer-typed value via "Other". */
  accountCurrency: string
  /** Raw numeric string as typed, without grouping separators. */
  amount: string
  amountCurrency: string
  /** "Source of funds" on a deposit, "Purpose of withdrawal" on a withdrawal. */
  sourceOfFunds: string
  processedByPhone: string
  confirmed: boolean
  /** Data URL (image/jpeg) of the captured customer photo. */
  photo: string | null
  /** Data URL (image/png) of the signature, transparent background. */
  signature: string | null
}

export interface DeviceContext {
  deviceId: string
  branch: string
  ip: string
}

export interface SubmissionMeta extends DeviceContext {
  referenceNo: string
  submittedAt: string
}

export const emptyForm = (kind: TxKind): FormData => ({
  kind,
  accountName: '',
  accountNumber: '',
  accountCurrency: 'LAK',
  amount: '',
  amountCurrency: 'LAK',
  sourceOfFunds: '',
  processedByPhone: '',
  confirmed: false,
  photo: null,
  signature: null,
})

export const SOURCE_MAX_LENGTH = 500
