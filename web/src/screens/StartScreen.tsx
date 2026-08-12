import { useI18n } from '../i18n/useI18n'
import { useFormStore } from '../state/formStore'
import type { TxKind } from '../lib/types'

const DepositIcon = () => (
  <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M24 6v22" strokeLinecap="round" />
    <path d="M15 21l9 9 9-9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 34v6a2 2 0 002 2h28a2 2 0 002-2v-6" strokeLinecap="round" />
  </svg>
)

const WithdrawalIcon = () => (
  <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M24 30V8" strokeLinecap="round" />
    <path d="M15 17l9-9 9 9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 34v6a2 2 0 002 2h28a2 2 0 002-2v-6" strokeLinecap="round" />
  </svg>
)

export const StartScreen = ({ onSettings }: { onSettings: () => void }) => {
  const { t } = useI18n()
  const { begin } = useFormStore()

  const options: { kind: TxKind; label: string; hint: string; icon: typeof DepositIcon }[] = [
    { kind: 'deposit', label: t('deposit'), hint: t('depositHint'), icon: DepositIcon },
    { kind: 'withdrawal', label: t('withdrawal'), hint: t('withdrawalHint'), icon: WithdrawalIcon },
  ]

  return (
    <div className="py-4">
      <h1 className="text-center text-2xl font-bold text-ink sm:text-3xl">{t('startTitle')}</h1>
      <p className="mt-2 text-center text-base text-muted">{t('startSubtitle')}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {options.map(({ kind, label, hint, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => begin(kind)}
            className="group flex min-h-[180px] flex-col items-start justify-between rounded-[18px] border border-line
              bg-white p-6 text-left shadow-[0_1px_2px_rgba(15,42,61,0.05)] transition-all
              hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_8px_24px_rgba(11,95,165,0.12)]
              active:translate-y-0"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 transition-colors group-hover:bg-brand-700 group-hover:text-white">
              <Icon />
            </span>
            <span className="mt-5">
              <span className="block text-xl font-bold text-ink">{label}</span>
              <span className="mt-1 block text-sm text-muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-10 text-center">
        <button
          type="button"
          onClick={onSettings}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted hover:bg-brand-100 hover:text-brand-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H2a2 2 0 110-4h.1A1.7 1.7 0 003.7 8.6a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H8a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V8a1.7 1.7 0 001.5 1h.2a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z" />
          </svg>
          {t('settings')}
        </button>
      </div>
    </div>
  )
}
