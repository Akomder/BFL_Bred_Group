import type { FormData, SubmissionMeta } from './types'

export const API_BASE: string | undefined = import.meta.env.VITE_API_BASE

/**
 * Deployment credential for the submission service. Vite inlines this into
 * the bundle at build time, so treat it as "keeps anonymous callers out",
 * not as a secret: anyone who can load the app can read it. Each deployment
 * gets its own key so one can be rotated without touching the others.
 */
export const API_KEY: string | undefined = import.meta.env.VITE_API_KEY

/** Every call to the service carries the key; the server rejects it otherwise. */
export const authHeaders = (): Record<string, string> =>
  API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}

/** Where every completed form is sent, per the operational requirement. */
export const PRIMARY_RECIPIENT = 'it.support@bfl.la'

export interface SubmitResult {
  referenceNo: string
  pdf: Blob
  fileName: string
  /** False on the rare submission the server couldn't deliver immediately —
   *  it was queued and will go out once mail recovers, not lost. */
  delivered: boolean
  copySentTo?: string
}

export interface SubmitOptions {
  data: FormData
  meta: SubmissionMeta
  /** Customer's address when they asked for a copy of the advice. */
  copyToEmail?: string
}

/**
 * Renders the PDF and hands it to the backend, which owns the email to
 * it.support@bfl.la and the Google Drive archive.
 */
export const submitForm = async ({ data, meta, copyToEmail }: SubmitOptions): Promise<SubmitResult> => {
  // pdf-lib and fontkit are only needed on the last step, so they stay out of
  // the initial bundle a branch tablet has to download.
  const { amountInWordsEn } = await import('./amountInWords')
  const { formatAmountForDisplay } = await import('./format')
  const { buildPdf, pdfFileName } = await import('./pdf')
  const bytes = await buildPdf({ data, meta })
  const pdf = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const fileName = pdfFileName(meta, data.kind)

  if (!API_BASE) {
    // A missing VITE_API_BASE is a deployment mistake, not a supported mode —
    // surfaces through the same error path a real network failure would.
    throw new Error('No server configured (VITE_API_BASE is not set).')
  }
  if (!API_KEY) {
    // Same class of mistake: the service rejects an unauthenticated form, so
    // fail here with the actual reason rather than on a confusing 401.
    throw new Error('No API key configured (VITE_API_KEY is not set).')
  }

  const body = new FormData()
  body.append(
    'payload',
    JSON.stringify({
      kind: data.kind,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      accountCurrency: data.accountCurrency,
      amount: data.amount,
      amountCurrency: data.amountCurrency,
      /* Grouped figures and the wording are computed here so the emails can
         quote the same values the customer signed, without the service having
         to reimplement the currency rules. */
      amountDisplay: formatAmountForDisplay(data.amount, data.amountCurrency),
      amountInWords: amountInWordsEn(data.amount, data.amountCurrency),
      sourceOfFunds: data.sourceOfFunds,
      processedByPhone: data.processedByPhone,
      consent: data.confirmed,
      meta,
      copyToEmail: copyToEmail ?? null,
    }),
  )
  /* The PDF only. The face photo and the signature are already drawn into it,
     so uploading them alongside sent a photograph of the customer and their
     handwritten signature across the network a second time, for nothing to
     read them — the service never looked at either field. */
  body.append('pdf', pdf, fileName)

  const res = await fetch(`${API_BASE}/api/submissions`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  })
  if (!res.ok) throw new Error(`Submission failed (${res.status})`)
  const result = (await res.json()) as { referenceNo?: string; delivered?: boolean }

  return {
    referenceNo: result.referenceNo ?? meta.referenceNo,
    pdf,
    fileName,
    // The server already retried and, failing that, queued the form rather
    // than losing it — `delivered: false` here means "queued", never "lost".
    delivered: result.delivered ?? true,
    copySentTo: copyToEmail,
  }
}

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Revoked on the next tick so the download has taken the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
