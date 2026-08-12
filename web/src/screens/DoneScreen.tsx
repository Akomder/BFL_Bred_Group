import { useI18n } from '../i18n/useI18n'
import { Button, Card } from '../components/ui'
import { downloadBlob, PRIMARY_RECIPIENT, type SubmitResult } from '../lib/submit'

export const DoneScreen = ({
  customerName,
  result,
  onRestart,
}: {
  customerName: string
  result: SubmitResult
  onRestart: () => void
}) => {
  const { t } = useI18n()

  return (
    <div className="py-6 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-brand-100">
        <svg viewBox="0 0 48 48" className="h-10 w-10 text-brand-700" fill="none" stroke="currentColor" strokeWidth="4">
          <path d="M12 25l8 8 16-18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h1 className="mt-6 text-3xl font-bold text-ink">{t('doneTitle')}</h1>
      <p className="mt-1 text-2xl font-bold text-brand-700">{customerName}</p>
      <p className="mx-auto mt-4 max-w-[520px] text-lg leading-relaxed text-ink">{t('doneWait')}</p>

      <Card className="mx-auto mt-8 max-w-[520px] text-left">
        <dl className="grid gap-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-semibold text-muted">{t('reference')}</dt>
            <dd className="font-mono font-bold text-ink">{result.referenceNo}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-semibold text-muted">{t('sentTo')}</dt>
            <dd className="text-right text-ink">
              {result.delivered ? PRIMARY_RECIPIENT : t('pendingDelivery')}
            </dd>
          </div>
          {result.copySentTo && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-semibold text-muted">{t('yourCopy')}</dt>
              <dd className="text-right text-ink">{result.copySentTo}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="mx-auto mt-6 flex max-w-[520px] flex-col gap-3 sm:flex-row">
        <Button variant="secondary" block onClick={() => downloadBlob(result.pdf, result.fileName)}>
          {t('downloadPdf')}
        </Button>
        <Button block onClick={onRestart}>
          {t('newTransaction')}
        </Button>
      </div>
    </div>
  )
}
