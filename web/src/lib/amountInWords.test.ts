import { describe, expect, it } from 'vitest'
import {
  amountInWordsEn,
  amountInWordsLo,
  numberToWordsEn,
  numberToWordsLo,
} from './amountInWords'
import { formatAmountForDisplay } from './format'

describe('English words', () => {
  it('handles the common branch amounts', () => {
    expect(numberToWordsEn(0)).toBe('zero')
    expect(numberToWordsEn(15)).toBe('fifteen')
    expect(numberToWordsEn(42)).toBe('forty-two')
    expect(numberToWordsEn(100)).toBe('one hundred')
    expect(numberToWordsEn(2000)).toBe('two thousand')
    expect(numberToWordsEn(1234)).toBe('one thousand two hundred thirty-four')
    expect(numberToWordsEn(2_500_000)).toBe('two million five hundred thousand')
  })

  it('renders the amount with its currency', () => {
    expect(amountInWordsEn('2000', 'LAK')).toBe('Two thousand Lao Kip only')
    expect(amountInWordsEn('1', 'USD')).toBe('One US Dollar only')
    expect(amountInWordsEn('25', 'USD')).toBe('Twenty-five US Dollars only')
    expect(amountInWordsEn('1234.50', 'USD')).toBe(
      'One thousand two hundred thirty-four US Dollars and fifty Cents only',
    )
    expect(amountInWordsEn('100.01', 'EUR')).toBe('One hundred Euros and one Cent only')
    expect(amountInWordsEn('500.25', 'THB')).toBe(
      'Five hundred Thai Baht and twenty-five Satang only',
    )
  })

  it('never emits a minor unit for a zero-decimal currency', () => {
    // The input sanitiser strips the decimals before this point; if one slips
    // through it rounds into kip, exactly as the figures on screen do.
    expect(amountInWordsEn('2000.99', 'LAK')).toBe('Two thousand one Lao Kip only')
    expect(formatAmountForDisplay('2000.99', 'LAK')).toBe('2,001')
  })
})

describe('Lao words', () => {
  it('uses ສິບ, ຊາວ and ເອັດ correctly', () => {
    expect(numberToWordsLo(0)).toBe('ສູນ')
    expect(numberToWordsLo(10)).toBe('ສິບ')
    expect(numberToWordsLo(11)).toBe('ສິບເອັດ')
    expect(numberToWordsLo(20)).toBe('ຊາວ')
    expect(numberToWordsLo(21)).toBe('ຊາວເອັດ')
    expect(numberToWordsLo(31)).toBe('ສາມສິບເອັດ')
    expect(numberToWordsLo(1)).toBe('ໜຶ່ງ')
  })

  it('builds the hundreds to millions scale', () => {
    expect(numberToWordsLo(100)).toBe('ໜຶ່ງຮ້ອຍ')
    expect(numberToWordsLo(2000)).toBe('ສອງພັນ')
    expect(numberToWordsLo(15_000)).toBe('ໜຶ່ງໝື່ນຫ້າພັນ')
    expect(numberToWordsLo(200_000)).toBe('ສອງແສນ')
    expect(numberToWordsLo(1_000_000)).toBe('ໜຶ່ງລ້ານ')
    expect(numberToWordsLo(2_500_000)).toBe('ສອງລ້ານຫ້າແສນ')
  })

  it('appends the currency and ຖ້ວນ', () => {
    expect(amountInWordsLo('2000', 'LAK')).toBe('ສອງພັນກີບຖ້ວນ')
    expect(amountInWordsLo('100', 'USD')).toBe('ໜຶ່ງຮ້ອຍໂດລາສະຫະລັດຖ້ວນ')
  })
})
