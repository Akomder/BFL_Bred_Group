import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_LENGTH,
  formatAccountNumber,
  formatAmount,
  formatAmountForDisplay,
  isAccountNumberComplete,
  isEmail,
  sanitizeAmount,
  splitAccountNumber,
} from './format'

describe('account number', () => {
  it('is 18 digits long', () => {
    expect(ACCOUNT_LENGTH).toBe(18)
  })

  it('groups digits as 3-7-2-4-2', () => {
    expect(splitAccountNumber('123456789012345678')).toEqual([
      '123',
      '4567890',
      '12',
      '3456',
      '78',
    ])
    expect(formatAccountNumber('123456789012345678')).toBe('123 4567890 12 3456 78')
  })

  it('keeps partial input usable and drops non-digits', () => {
    expect(formatAccountNumber('12')).toBe('12')
    expect(formatAccountNumber('123 45')).toBe('123 45')
    expect(formatAccountNumber('abc123')).toBe('123')
  })

  it('never exceeds the mask length', () => {
    expect(formatAccountNumber('1'.repeat(30))).toBe('111 1111111 11 1111 11')
  })

  it('reports completeness', () => {
    expect(isAccountNumberComplete('1'.repeat(17))).toBe(false)
    expect(isAccountNumberComplete('1'.repeat(18))).toBe(true)
  })
})

describe('amount formatting', () => {
  it('groups thousands', () => {
    expect(formatAmount('200000', 'LAK')).toBe('200,000')
    expect(formatAmount('2000000', 'LAK')).toBe('2,000,000')
    expect(formatAmount('999', 'LAK')).toBe('999')
  })

  it('drops decimals for LAK but keeps them for USD', () => {
    expect(sanitizeAmount('1234.56', 'LAK')).toBe('1234')
    expect(sanitizeAmount('1234.567', 'USD')).toBe('1234.56')
    expect(formatAmount('1234.5', 'USD')).toBe('1,234.5')
  })

  it('tolerates a trailing decimal point while typing', () => {
    expect(formatAmount('1234.', 'USD')).toBe('1,234.')
    expect(sanitizeAmount('12.34.56', 'USD')).toBe('12.34')
  })

  it('pads to the currency decimals for display', () => {
    expect(formatAmountForDisplay('1234.5', 'USD')).toBe('1,234.50')
    expect(formatAmountForDisplay('2000', 'LAK')).toBe('2,000')
    expect(formatAmountForDisplay('', 'LAK')).toBe('0')
  })
})

describe('email validation', () => {
  it('accepts real addresses and rejects malformed ones', () => {
    expect(isEmail('it.support@bfl.la')).toBe(true)
    expect(isEmail('customer@example.com')).toBe(true)
    expect(isEmail('nope')).toBe(false)
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
  })
})
