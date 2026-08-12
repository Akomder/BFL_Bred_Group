import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useFormStore } from '../state/formStore'
import { AccountNumberInput } from '../components/AccountNumberInput'
import { Button, Card, Chevron, ErrorText, FieldLabel, inputClass, selectClass } from '../components/ui'
import { formatAmount, isAccountNumberComplete, parseAmount, sanitizeAmount } from '../lib/format'
import { CURRENCIES, SOURCE_MAX_LENGTH, type CurrencyCode } from '../lib/types'

type ErrorKey =
  | 'accountName'
  | 'accountNumber'
  | 'amount'
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
  if (parseAmount(data.amount) <= 0) found.amount = t('amountRequired')
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
   *  until the customer overrides the amount currency themselves. */
  const changeAccountCurrency = (code: CurrencyCode) => {
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
            <ErrorText>{errors.accountNumber}</ErrorText>
          </div>

          <div className="sm:max-w-[260px]">
            <FieldLabel htmlFor="accountCurrency">{t('accountCurrency')}</FieldLabel>
            <div className="relative">
              <select
                id="accountCurrency"
                value={data.accountCurrency}
                onChange={(e) => changeAccountCurrency(e.target.value as CurrencyCode)}
                className={selectClass()}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Chevron />
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
                  value={data.amountCurrency}
                  onChange={(e) => {
                    const code = e.target.value as CurrencyCode
                    patch({ amountCurrency: code, amount: sanitizeAmount(data.amount, code) })
                  }}
                  className={selectClass()}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <Chevron />
              </div>
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
