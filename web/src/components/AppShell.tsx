import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { useI18n } from '../i18n/useI18n'
import type { Step } from '../state/formStore'

const STEPS: { id: Step; key: 'stepDetails' | 'stepPhoto' | 'stepSignature' | 'stepReview' }[] = [
  { id: 'form', key: 'stepDetails' },
  { id: 'photo', key: 'stepPhoto' },
  { id: 'signature', key: 'stepSignature' },
  { id: 'review', key: 'stepReview' },
]

const LanguageToggle = () => {
  const { lang, setLang } = useI18n()
  return (
    <div className="flex rounded-full border border-brand-200 bg-white p-1" role="group" aria-label="Language">
      {(['en', 'lo'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`min-h-[36px] rounded-full px-4 text-sm font-semibold transition-colors ${
            lang === code ? 'bg-brand-700 text-white' : 'text-brand-700 hover:bg-brand-50'
          }`}
        >
          {code === 'en' ? 'EN' : 'ລາວ'}
        </button>
      ))}
    </div>
  )
}

const StepIndicator = ({ current }: { current: Step }) => {
  const { t } = useI18n()
  const index = STEPS.findIndex((s) => s.id === current)
  if (index < 0) return null
  return (
    <ol className="mx-auto flex w-full max-w-[880px] items-center gap-2 px-4 pb-4 sm:gap-3">
      {STEPS.map((step, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'todo'
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === 'todo'
                  ? 'bg-white text-muted ring-1 ring-line'
                  : 'bg-brand-700 text-white'
              }`}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span
              className={`hidden text-sm font-semibold sm:inline ${
                state === 'current' ? 'text-brand-800' : 'text-muted'
              }`}
            >
              {t(step.key)}
            </span>
            {i < STEPS.length - 1 && (
              <span className={`h-[3px] flex-1 rounded-full ${i < index ? 'bg-brand-700' : 'bg-line'}`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export const AppShell = ({
  children,
  step,
  onLogoClick,
}: {
  children: ReactNode
  step: Step
  onLogoClick?: () => void
}) => {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-4 px-4 py-3">
          <button
            type="button"
            onClick={onLogoClick}
            className="flex items-center gap-3 rounded-lg text-left"
            aria-label="BFL BRED Group"
          >
            <Logo className="h-9 sm:h-10" />
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-semibold text-muted md:inline">{t('appTitle')}</span>
            <LanguageToggle />
          </div>
        </div>
        <StepIndicator current={step} />
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 py-5 sm:py-8">{children}</main>

      <footer className="mx-auto w-full max-w-[880px] px-4 pb-6 pt-2 text-center text-xs text-muted">
        BFL BRED Group · {t('appTitle')}
      </footer>
    </div>
  )
}
