import type { FormData, SubmissionMeta } from './types'

export const API_BASE: string | undefined = import.meta.env.VITE_API_BASE
export const isDemoMode = (): boolean => !API_BASE

/** Where every completed form is sent, per the operational requirement. */
export const PRIMARY_RECIPIENT = 'it.support@bfl.la'

export interface SubmitResult {
  referenceNo: string
  pdf: Blob
  fileName: string
  /** False when the app ran without a backend and only produced the PDF locally. */
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
 * it.support@bfl.la and the SharePoint archive. With no backend configured the
 * PDF is still produced so the flow can be demonstrated end to end.
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
    return { referenceNo: meta.referenceNo, pdf, fileName, delivered: false, copySentTo: copyToEmail }
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
  body.append('pdf', pdf, fileName)
  if (data.photo) body.append('photo', await (await fetch(data.photo)).blob(), 'photo.jpg')
  if (data.signature) body.append('signature', await (await fetch(data.signature)).blob(), 'signature.png')

  const res = await fetch(`${API_BASE}/api/submissions`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Submission failed (${res.status})`)
  const result = (await res.json()) as { referenceNo?: string }

  return {
    referenceNo: result.referenceNo ?? meta.referenceNo,
    pdf,
    fileName,
    delivered: true,
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
