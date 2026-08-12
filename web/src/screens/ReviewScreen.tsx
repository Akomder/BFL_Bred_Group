import type { ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useFormStore, type Step } from '../state/formStore'
import { Button, Card } from '../components/ui'
import { amountInWordsEn, amountInWordsLo } from '../lib/amountInWords'
import { formatAccountNumber, formatAmountForDisplay, formatDateTime } from '../lib/format'
import type { SubmissionMeta } from '../lib/types'

const Value = ({ children }: { children: ReactNode }) => (
  <dd className="mt-1 text-base font-semibold break-words text-ink">{children}</dd>
)

const Label = ({ children }: { children: ReactNode }) => (
  <dt className="text-xs font-bold uppercase tracking-wide text-muted">{children}</dt>
)

/** One numbered row of the review sheet, with the Edit control that owns it. */
const Row = ({
  index,
  onEdit,
  children,
}: {
  index: number
  onEdit?: () => void
  children: ReactNode
}) => {
  const { t } = useI18n()
  return (
    <div className="relative border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${t('edit')} — row ${index}`}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
          >
            {t('edit')}
          </button>
        )}
      </div>
    </div>
  )
}

const Pair = ({ children }: { children: ReactNode }) => (
  <dl className="grid gap-4 sm:grid-cols-2">{children}</dl>
)

export const ReviewScreen = ({
  meta,
  onSubmit,
}: {
  meta: SubmissionMeta
  onSubmit: () => void
}) => {
  const { t, lang } = useI18n()
  const { data, editFrom, goto } = useFormStore()
  const isDeposit = data.kind === 'deposit'
  const edit = (step: Step) => () => editFrom(step)

  const figures = formatAmountForDisplay(data.amount, data.amountCurrency)
  const wordsEn = amountInWordsEn(data.amount, data.amountCurrency)
  const wordsLo = amountInWordsLo(data.amount, data.amountCurrency)

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">{t('reviewTitle')}</h1>
      <p className="mt-2 text-base text-muted">{t('reviewSubtitle')}</p>

      <Card className="mt-5 !p-0">
        {/* Row 1 — Account name, account number */}
        <Row index={1} onEdit={edit('form')}>
          <Pair>
            <div>
              <Label>{t('accountName')}</Label>
              <Value>{data.accountName}</Value>
            </div>
            <div>
              <Label>{t('accountNumber')}</Label>
              <Value>
                <span className="font-mono tracking-wide">{formatAccountNumber(data.accountNumber)}</span>
              </Value>
            </div>
          </Pair>
        </Row>

        {/* Row 2 — Amount, currency */}
        <Row index={2} onEdit={edit('form')}>
          <Pair>
            <div>
              <Label>{isDeposit ? t('amountOfDeposit') : t('amountOfWithdrawal')}</Label>
              <Value>
                <span className="font-mono text-xl">{figures}</span>
              </Value>
            </div>
            <div>
              <Label>{isDeposit ? t('depositCurrency') : t('withdrawalCurrency')}</Label>
              <Value>
                <span className="inline-flex rounded-lg bg-brand-100 px-3 py-1 text-brand-800">
                  {data.amountCurrency}
                </span>
              </Value>
            </div>
          </Pair>
        </Row>

        {/* Row 3 — Amount in wording */}
        <Row index={3}>
          <Label>{t('amountInWords')}</Label>
          <Value>
            <span className="block">{lang === 'lo' ? wordsLo : wordsEn}</span>
            <span className="mt-1 block text-sm font-normal text-muted">
              {lang === 'lo' ? wordsEn : wordsLo}
            </span>
          </Value>
        </Row>

        {/* Row 4 — Source of funds / purpose */}
        <Row index={4} onEdit={edit('form')}>
          <Label>{isDeposit ? t('sourceOfFunds') : t('purposeOfWithdrawal')}</Label>
          <Value>
            <span className="whitespace-pre-wrap font-normal">{data.sourceOfFunds}</span>
          </Value>
        </Row>

        {/* Row 5 — Processed by phone number */}
        <Row index={5} onEdit={edit('form')}>
          <Label>{t('processedBy')}</Label>
          <Value>{data.processedByPhone}</Value>
        </Row>

        {/* Row 6 — Submission date/time, branch location */}
        <Row index={6}>
          <Pair>
            <div>
              <Label>{t('submissionDateTime')}</Label>
              <Value>{formatDateTime(meta.submittedAt)}</Value>
            </div>
            <div>
              <Label>{t('branchLocation')}</Label>
              <Value>{meta.branch}</Value>
            </div>
          </Pair>
        </Row>

        {/* Row 7 — Device ID / IP */}
        <Row index={7}>
          <Pair>
            <div>
              <Label>{t('deviceId')}</Label>
              <Value>
                <span className="font-mono text-sm">{meta.deviceId}</span>
              </Value>
            </div>
            <div>
              <Label>{t('ipAddress')}</Label>
              <Value>
                <span className="font-mono text-sm">{meta.ip}</span>
              </Value>
            </div>
          </Pair>
        </Row>

        {/* Row 8 — Photo, signature */}
        <Row index={8}>
          <Pair>
            <div>
              <Label>{t('customerPhoto')}</Label>
              <div className="mt-2 flex items-start gap-3">
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl border border-line bg-brand-50">
                  {data.photo ? (
                    <img src={data.photo} alt={t('customerPhoto')} className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-xs text-muted">{t('notCaptured')}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={edit('photo')}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                >
                  {t('edit')}
                </button>
              </div>
            </div>
            <div>
              <Label>{t('signature')}</Label>
              <div className="mt-2 flex items-start gap-3">
                <div className="flex h-28 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
                  {data.signature ? (
                    <img src={data.signature} alt={t('signature')} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="px-2 text-center text-xs text-muted">{t('notCaptured')}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={edit('signature')}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                >
                  {t('edit')}
                </button>
              </div>
            </div>
          </Pair>
        </Row>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <Button onClick={onSubmit} block>
          {t('submit')}
        </Button>
        <Button variant="secondary" block onClick={() => goto('signature', null)}>
          {t('back')}
        </Button>
      </div>
    </div>
  )
}
