import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { Button, ErrorText, FieldLabel, inputClass } from './ui'
import { isEmail } from '../lib/format'

/**
 * Asked right before sending: the customer chooses whether they want their own
 * PDF copy, and by email only. The form always goes to it.support@bfl.la
 * regardless of what is chosen here.
 */
export const CopyRequestModal = ({
  open,
  sending,
  error,
  onCancel,
  onSend,
}: {
  open: boolean
  sending: boolean
  error?: string
  onCancel: () => void
  onSend: (email?: string) => void
}) => {
  const { t } = useI18n()
  const [wantsCopy, setWantsCopy] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setWantsCopy(null)
      setEmail('')
      setTouched(false)
      dialogRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const emailInvalid = wantsCopy === true && touched && !isEmail(email)
  const canSend = wantsCopy === false || (wantsCopy === true && isEmail(email))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-title"
        tabIndex={-1}
        className="w-full max-w-[480px] rounded-[18px] bg-white p-6 shadow-xl"
      >
        <h2 id="copy-title" className="text-xl font-bold text-ink">
          {t('copyTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted">{t('copyBody')}</p>

        <div className="mt-5 grid gap-3">
          {[
            { value: true, label: t('copyYes') },
            { value: false, label: t('copyNo') },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => setWantsCopy(option.value)}
              aria-pressed={wantsCopy === option.value}
              className={`min-h-[52px] rounded-xl border px-4 text-left font-semibold transition-colors ${
                wantsCopy === option.value
                  ? 'border-brand-600 bg-brand-100 text-brand-800'
                  : 'border-line bg-white text-ink hover:bg-brand-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {wantsCopy === true && (
          <div className="mt-4">
            <FieldLabel htmlFor="copyEmail" required>
              {t('emailLabel')}
            </FieldLabel>
            <input
              id="copyEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              inputMode="email"
              autoComplete="email"
              aria-invalid={emailInvalid}
              className={inputClass(emailInvalid)}
            />
            <ErrorText>{emailInvalid ? t('emailInvalid') : null}</ErrorText>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <Button
            block
            disabled={!canSend || sending}
            onClick={() => onSend(wantsCopy ? email.trim() : undefined)}
          >
            {sending ? t('sending') : t('sendForm')}
          </Button>
          <Button variant="secondary" block onClick={onCancel} disabled={sending}>
            {t('back')}
          </Button>
        </div>
      </div>
    </div>
  )
}
