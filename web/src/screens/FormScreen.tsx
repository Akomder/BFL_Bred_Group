import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useFormStore } from '../state/formStore'
import { AccountNumberInput } from '../components/AccountNumberInput'
import { Button, Card, Chevron, ErrorText, FieldLabel, inputClass, selectClass } from '../components/ui'
import { formatAmount, isAccountNumberComplete, parseAmount, sanitizeAmount } from '../lib/format'
import { CURRENCIES, SOURCE_MAX_LENGTH, type CurrencyCode } from '../lib/types'

const OTHER_CURRENCY = 'OTHER'
const CUSTOM_CURRENCY_MAX_LENGTH = 6

/** Whether the stored currency value isn't one of the known codes — i.e. the
 *  customer typed a custom one via "Other". Derived from the value itself
 *  rather than tracked as separate UI state, so it can't get out of sync. */
const isCustomCurrency = (value: string): boolean =>
  !CURRENCIES.includes(value as CurrencyCode)

/** A custom currency is a code, not free text — letters only (no digits or
 *  symbols), uppercased as typed, capped to a short length. */
const sanitizeCurrencyCode = (value: string): string =>
  value
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, CUSTOM_CURRENCY_MAX_LENGTH)

type ErrorKey =
  | 'accountName'
  | 'accountNumber'
  | 'accountCurrency'
  | 'amount'
  | 'amountCurrency'
  | 'sourceOfFunds'
  | 'processedByPhone'
  | 'confirmed'
type Errors = Partial<Record<ErrorKey, string>>

export const FormScreen = () => {
  const { t } = useI18n()
  const { data, patch, advance, goto, returnTo } = useFormStore()
  /* Errors appear only once the customer has tried to continue, then track the
     fields live so a message disappears the moment its field is corrected. */
  const [showErrors, setShowErrors] = useState(false)
  const isDeposit = data.kind === 'deposit'

  const found: Errors = {}
  if (!data.accountName.trim()) found.accountName = t('required')
  if (!isAccountNumberComplete(data.accountNumber)) found.accountNumber = t('accountIncomplete')
  if (!data.accountCurrency.trim()) found.accountCurrency = t('required')
  if (parseAmount(data.amount) <= 0) found.amount = t('amountRequired')
  if (!data.amountCurrency.trim()) found.amountCurrency = t('required')
  if (!data.sourceOfFunds.trim()) found.sourceOfFunds = t('required')
  if (!data.processedByPhone.trim()) found.processedByPhone = t('required')
  if (!data.confirmed) found.confirmed = t('consentRequired')

  const errors: Errors = showErrors ? found : {}

  const submit = () => {
    if (Object.keys(found).length > 0) {
      setShowErrors(true)
      // Wait for the messages to render before scrolling to the first one.
      requestAnimationFrame(() =>
        document
          .querySelector('[aria-invalid="true"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      )
      return
    }
    advance()
  }

  /** Changing the account currency re-points the amount currency with it,
   *  until the customer overrides the amount currency themselves. Picking
   *  "Other" in the select starts the custom value blank — the textbox that
   *  appears (customAccountCurrency below) is what actually sets it. */
  const changeAccountCurrency = (selected: string) => {
    const code = selected === OTHER_CURRENCY ? '' : selected
    const followed = data.amountCurrency === data.accountCurrency
    patch({
      accountCurrency: code,
      ...(followed ? { amountCurrency: code, amount: sanitizeAmount(data.amount, code) } : {}),
    })
  }

  const customAccountCurrency = (code: string) => {
    const followed = data.amountCurrency === data.accountCurrency
    patch({
      accountCurrency: code,
      ...(followed ? { amountCurrency: code, amount: sanitizeAmount(data.amount, code) } : {}),
    })
  }

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">
        {isDeposit ? t('deposit') : t('withdrawal')}
      </h1>

      <Card className="mt-5">
        <div className="grid gap-5">
          <div>
            <FieldLabel htmlFor="accountName" required>
              {t('accountName')}
            </FieldLabel>
            <input
              id="accountName"
              value={data.accountName}
              onChange={(e) => patch({ accountName: e.target.value })}
              autoComplete="off"
              aria-invalid={Boolean(errors.accountName)}
              className={inputClass(Boolean(errors.accountName))}
            />
            <ErrorText>{errors.accountName}</ErrorText>
          </div>

          {/* Account number and its currency share one row, mirroring the amount row below. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <FieldLabel htmlFor="accountNumber" required>
                {t('accountNumber')}
              </FieldLabel>
              <div aria-invalid={Boolean(errors.accountNumber)}>
                <AccountNumberInput
                  id="accountNumber"
                  value={data.accountNumber}
                  onChange={(accountNumber) => patch({ accountNumber })}
                  invalid={Boolean(errors.accountNumber)}
                />
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="accountCurrency">{t('accountCurrency')}</FieldLabel>
              <div className="relative">
                <select
                  id="accountCurrency"
                  value={isCustomCurrency(data.accountCurrency) ? OTHER_CURRENCY : data.accountCurrency}
                  onChange={(e) => changeAccountCurrency(e.target.value)}
                  className={selectClass()}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER_CURRENCY}>{t('otherCurrency')}</option>
                </select>
                <Chevron />
              </div>
              {isCustomCurrency(data.accountCurrency) && (
                <input
                  value={data.accountCurrency}
                  onChange={(e) => customAccountCurrency(sanitizeCurrencyCode(e.target.value))}
                  placeholder={t('otherCurrencyPlaceholder')}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.accountCurrency)}
                  className={`${inputClass(Boolean(errors.accountCurrency))} mt-2`}
                />
              )}
            </div>
            <div className="sm:col-span-2 -mt-1 grid gap-1 sm:grid-cols-[1fr_160px]">
              <ErrorText>{errors.accountNumber}</ErrorText>
              <ErrorText>{errors.accountCurrency}</ErrorText>
            </div>
          </div>

          {/* Amount and its currency share one row, as on the paper form. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <FieldLabel htmlFor="amount" required>
                {isDeposit ? t('amountDeposit') : t('amountWithdrawal')}
              </FieldLabel>
              <input
                id="amount"
                value={formatAmount(data.amount, data.amountCurrency)}
                onChange={(e) => patch({ amount: sanitizeAmount(e.target.value, data.amountCurrency) })}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={Boolean(errors.amount)}
                className={`${inputClass(Boolean(errors.amount))} text-right font-mono text-lg`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="amountCurrency">{t('currency')}</FieldLabel>
              <div className="relative">
                <select
                  id="amountCurrency"
                  value={isCustomCurrency(data.amountCurrency) ? OTHER_CURRENCY : data.amountCurrency}
                  onChange={(e) => {
                    const code = e.target.value === OTHER_CURRENCY ? '' : e.target.value
                    patch({ amountCurrency: code, amount: sanitizeAmount(data.amount, code) })
                  }}
                  className={selectClass()}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER_CURRENCY}>{t('otherCurrency')}</option>
                </select>
                <Chevron />
              </div>
              {isCustomCurrency(data.amountCurrency) && (
                <input
                  value={data.amountCurrency}
                  onChange={(e) => {
                    const code = sanitizeCurrencyCode(e.target.value)
                    patch({ amountCurrency: code, amount: sanitizeAmount(data.amount, code) })
                  }}
                  placeholder={t('otherCurrencyPlaceholder')}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.amountCurrency)}
                  className={`${inputClass(Boolean(errors.amountCurrency))} mt-2`}
                />
              )}
              <ErrorText>{errors.amountCurrency}</ErrorText>
            </div>
            <div className="sm:col-span-2 -mt-1">
              <ErrorText>{errors.amount}</ErrorText>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="sourceOfFunds" required>
              {isDeposit ? t('sourceOfFunds') : t('purposeOfWithdrawal')}
            </FieldLabel>
            <textarea
              id="sourceOfFunds"
              value={data.sourceOfFunds}
              onChange={(e) => patch({ sourceOfFunds: e.target.value.slice(0, SOURCE_MAX_LENGTH) })}
              maxLength={SOURCE_MAX_LENGTH}
              rows={4}
              aria-invalid={Boolean(errors.sourceOfFunds)}
              className={`${inputClass(Boolean(errors.sourceOfFunds))} resize-y`}
            />
            <div className="mt-1 flex items-start justify-between gap-4">
              <ErrorText>{errors.sourceOfFunds}</ErrorText>
              <span className="ml-auto shrink-0 text-sm text-muted">
                {SOURCE_MAX_LENGTH - data.sourceOfFunds.length} {t('charactersLeft')}
              </span>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="processedByPhone" required>
              {t('processedByPhone')}
            </FieldLabel>
            <input
              id="processedByPhone"
              value={data.processedByPhone}
              onChange={(e) => patch({ processedByPhone: e.target.value })}
              inputMode="tel"
              autoComplete="off"
              aria-invalid={Boolean(errors.processedByPhone)}
              className={inputClass(Boolean(errors.processedByPhone))}
            />
            <ErrorText>{errors.processedByPhone}</ErrorText>
          </div>
        </div>
      </Card>

      <Card className={`mt-5 ${errors.confirmed ? 'border-danger' : 'bg-brand-50'}`}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={data.confirmed}
            onChange={(e) => patch({ confirmed: e.target.checked })}
            aria-invalid={Boolean(errors.confirmed)}
            className="mt-0.5 h-6 w-6 shrink-0 accent-brand-700"
          />
          <span className="text-sm leading-relaxed text-ink">{t('consent')}</span>
        </label>
        <ErrorText>{errors.confirmed}</ErrorText>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <Button onClick={submit} block>
          {returnTo === 'review' ? t('saveAndReturn') : t('continue')}
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => (returnTo === 'review' ? goto('review', null) : goto('start', null))}
        >
          {t('back')}
        </Button>
      </div>
    </div>
  )
}
