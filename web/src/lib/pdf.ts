import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getLogoBytes } from '../components/Logo'
import { amountInWordsEn, amountInWordsLo } from './amountInWords'
import { formatAccountNumber, formatAmountForDisplay, formatDateTime } from './format'
import type { FormData, SubmissionMeta } from './types'

const BRAND = rgb(0.043, 0.373, 0.647) // #0B5FA5
const INK = rgb(0.059, 0.165, 0.239) // #0F2A3D
const MUTED = rgb(0.353, 0.478, 0.565) // #5A7A90
const LINE = rgb(0.812, 0.894, 0.953) // #CFE4F3
const PANEL = rgb(0.957, 0.98, 1) // #F4FAFF

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const CONTENT = A4.width - MARGIN * 2

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  lao: PDFFont
  laoBold: PDFFont
  /** fontkit views of the Lao faces, used to position their marks. */
  laoShaper: LaoShaper | null
  laoBoldShaper: LaoShaper | null
}

interface LaoShaper {
  unitsPerEm: number
  layout: (text: string) => {
    glyphs: { codePoints: number[] }[]
    positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[]
  }
}

const fetchFont = async (path: string): Promise<ArrayBuffer> => {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`font ${path} ${res.status}`)
  return res.arrayBuffer()
}

/** True when the string contains any character in the Lao Unicode block. */
const hasLao = (text: string): boolean => /[຀-໿]/.test(text)

/**
 * WinAnsi-only standard fonts cannot draw Lao, and the Lao font has no Latin
 * coverage worth using, so every string is routed by script.
 */
const pickFont = (fonts: Fonts, text: string, bold: boolean): PDFFont =>
  hasLao(text) ? (bold ? fonts.laoBold : fonts.lao) : bold ? fonts.bold : fonts.regular

/**
 * Draws Lao text one glyph at a time at the positions fontkit computed.
 *
 * pdf-lib substitutes glyphs but writes them with their own advances only, so
 * the GPOS offsets that stack a Lao vowel and tone mark over their base are
 * lost and the marks land to the right of the syllable. Placing each glyph
 * explicitly puts them back where they belong.
 */
const drawShapedText = (
  page: PDFPage,
  shaper: LaoShaper,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
): void => {
  const run = shaper.layout(value)
  const scale = size / shaper.unitsPerEm
  let pen = 0
  for (let i = 0; i < run.glyphs.length; i += 1) {
    const position = run.positions[i]
    page.drawText(String.fromCodePoint(...run.glyphs[i].codePoints), {
      x: x + (pen + (position.xOffset ?? 0)) * scale,
      y: y + (position.yOffset ?? 0) * scale,
      size,
      font,
      color,
    })
    pen += position.xAdvance ?? 0
  }
}

/** Greedy word wrap that measures with the same font it will draw with. */
const wrap = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line === '') {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

interface Cursor {
  page: PDFPage
  y: number
}

export interface PdfInput {
  data: FormData
  meta: SubmissionMeta
}

export const buildPdf = async ({ data, meta }: PdfInput): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)

  // subset: false is deliberate — pdf-lib's runtime subsetter silently drops
  // glyphs from these fonts. The files in public/fonts are already subset to
  // Latin/Lao by scripts/build-fonts.sh, so embedding them whole is both
  // correct and small.
  const fonts: Fonts = await (async (): Promise<Fonts> => {
    try {
      const [regularBytes, boldBytes, laoBytes, laoBoldBytes] = await Promise.all([
        fetchFont('/fonts/NotoSans-Regular.ttf'),
        fetchFont('/fonts/NotoSans-Bold.ttf'),
        fetchFont('/fonts/NotoSansLao-Regular.ttf'),
        fetchFont('/fonts/NotoSansLao-Bold.ttf'),
      ])
      return {
        regular: await doc.embedFont(regularBytes, { subset: false }),
        bold: await doc.embedFont(boldBytes, { subset: false }),
        lao: await doc.embedFont(laoBytes, { subset: false }),
        laoBold: await doc.embedFont(laoBoldBytes, { subset: false }),
        laoShaper: fontkit.create(new Uint8Array(laoBytes)) as unknown as LaoShaper,
        laoBoldShaper: fontkit.create(new Uint8Array(laoBoldBytes)) as unknown as LaoShaper,
      }
    } catch {
      // Never fail a submission over a font: fall back to the built-ins, which
      // costs the Lao line rather than the whole document.
      const helv = await doc.embedFont(StandardFonts.Helvetica)
      const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)
      return {
        regular: helv,
        bold: helvBold,
        lao: helv,
        laoBold: helvBold,
        laoShaper: null,
        laoBoldShaper: null,
      }
    }
  })()

  const page = doc.addPage([A4.width, A4.height])
  const cursor: Cursor = { page, y: A4.height - MARGIN }

  /** Single entry point for every string on the page: picks the font by script
   *  and takes the shaped path when the text is Lao. */
  const text = (
    value: string,
    x: number,
    y: number,
    { size = 10, bold: isBold = false, color = INK } = {},
  ) => {
    const font = pickFont(fonts, value, isBold)
    const shaper = isBold ? fonts.laoBoldShaper : fonts.laoShaper
    if (hasLao(value) && shaper) {
      drawShapedText(cursor.page, shaper, font, value, x, y, size, color)
      return
    }
    cursor.page.drawText(value, { x, y, size, font, color })
  }

  /* ------------------------------------------------------------- header */
  try {
    const logo = await doc.embedPng(await getLogoBytes())
    const logoWidth = 150
    const logoHeight = (logo.height / logo.width) * logoWidth
    cursor.page.drawImage(logo, {
      x: MARGIN,
      y: cursor.y - logoHeight,
      width: logoWidth,
      height: logoHeight,
    })
    cursor.y -= logoHeight + 10
  } catch {
    text('BFL BRED GROUP', MARGIN, cursor.y - 18, { size: 18, bold: true, color: BRAND })
    cursor.y -= 34
  }

  const title = data.kind === 'deposit' ? 'CASH DEPOSIT FORM' : 'CASH WITHDRAWAL FORM'
  text(title, MARGIN, cursor.y - 6, { size: 16, bold: true, color: BRAND })
  const refWidth = fonts.regular.widthOfTextAtSize(meta.referenceNo, 10)
  text(meta.referenceNo, A4.width - MARGIN - refWidth, cursor.y - 4, { size: 10, color: MUTED })
  cursor.y -= 18

  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: A4.width - MARGIN, y: cursor.y },
    thickness: 2,
    color: BRAND,
  })
  cursor.y -= 24

  /* -------------------------------------------------------------- rows */
  const row = (label: string, value: string, opts: { mono?: boolean } = {}) => {
    const labelSize = 8.5
    const valueSize = opts.mono ? 11 : 10.5
    text(label.toUpperCase(), MARGIN, cursor.y, { size: labelSize, bold: true, color: MUTED })
    cursor.y -= 14
    const font = pickFont(fonts, value, false)
    for (const line of wrap(value || '—', font, valueSize, CONTENT)) {
      text(line, MARGIN, cursor.y, { size: valueSize })
      cursor.y -= valueSize + 4
    }
    cursor.y -= 8
  }

  const twoUp = (
    left: [string, string],
    right: [string, string],
  ) => {
    const half = CONTENT / 2 - 8
    const startY = cursor.y
    let leftY = startY
    let rightY = startY
    const column = ([label, value]: [string, string], x: number, y: number) => {
      text(label.toUpperCase(), x, y, { size: 8.5, bold: true, color: MUTED })
      let cy = y - 14
      const font = pickFont(fonts, value, false)
      for (const line of wrap(value || '—', font, 10.5, half)) {
        text(line, x, cy, { size: 10.5 })
        cy -= 14.5
      }
      return cy
    }
    leftY = column(left, MARGIN, startY)
    rightY = column(right, MARGIN + CONTENT / 2 + 8, startY)
    cursor.y = Math.min(leftY, rightY) - 8
  }

  const amountFigures = `${formatAmountForDisplay(data.amount, data.amountCurrency)} ${data.amountCurrency}`

  twoUp(['Account name', data.accountName], ['Account number', formatAccountNumber(data.accountNumber)])
  twoUp(
    [data.kind === 'deposit' ? 'Amount of deposit' : 'Amount of withdrawal', amountFigures],
    ['Account currency', data.accountCurrency],
  )

  /* Amount in words gets its own highlighted panel — it is the field the
     paper form exists to capture unambiguously. */
  const wordsEn = amountInWordsEn(data.amount, data.amountCurrency)
  const wordsLo = amountInWordsLo(data.amount, data.amountCurrency)
  const wordsEnLines = wrap(wordsEn, fonts.regular, 11, CONTENT - 24)
  const wordsLoLines = wrap(wordsLo, fonts.lao, 11, CONTENT - 24)
  const panelHeight = 24 + (wordsEnLines.length + wordsLoLines.length) * 15
  cursor.page.drawRectangle({
    x: MARGIN,
    y: cursor.y - panelHeight + 12,
    width: CONTENT,
    height: panelHeight,
    color: PANEL,
    borderColor: LINE,
    borderWidth: 1,
  })
  text('AMOUNT IN WORDS', MARGIN + 12, cursor.y, { size: 8.5, bold: true, color: MUTED })
  cursor.y -= 16
  for (const line of wordsEnLines) {
    text(line, MARGIN + 12, cursor.y, { size: 11, bold: true })
    cursor.y -= 15
  }
  for (const line of wordsLoLines) {
    text(line, MARGIN + 12, cursor.y, { size: 11 })
    cursor.y -= 15
  }
  cursor.y -= 18

  row(data.kind === 'deposit' ? 'Source of funds' : 'Purpose of withdrawal', data.sourceOfFunds)
  row('Processed by — phone number', data.processedByPhone)

  twoUp(
    ['Submission date / time', formatDateTime(meta.submittedAt)],
    ['Branch location', meta.branch],
  )
  twoUp(['Device ID', meta.deviceId], ['IP address', meta.ip])

  /* ----------------------------------------------- photo and signature */
  cursor.y -= 4
  const boxWidth = CONTENT / 2 - 8
  const boxHeight = 130
  const boxY = cursor.y - boxHeight

  text('PHOTO OF CUSTOMER', MARGIN, cursor.y + 4, { size: 8.5, bold: true, color: MUTED })
  text('SIGNATURE', MARGIN + CONTENT / 2 + 8, cursor.y + 4, { size: 8.5, bold: true, color: MUTED })
  cursor.y -= 10

  const drawFramed = async (dataUrl: string | null, x: number) => {
    cursor.page.drawRectangle({
      x,
      y: boxY - 6,
      width: boxWidth,
      height: boxHeight,
      borderColor: LINE,
      borderWidth: 1,
      color: rgb(1, 1, 1),
    })
    if (!dataUrl) return
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
    const image = dataUrl.startsWith('data:image/png')
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes)
    const pad = 8
    const scale = Math.min(
      (boxWidth - pad * 2) / image.width,
      (boxHeight - pad * 2) / image.height,
    )
    const w = image.width * scale
    const h = image.height * scale
    cursor.page.drawImage(image, {
      x: x + (boxWidth - w) / 2,
      y: boxY - 6 + (boxHeight - h) / 2,
      width: w,
      height: h,
    })
  }

  await drawFramed(data.photo, MARGIN)
  await drawFramed(data.signature, MARGIN + CONTENT / 2 + 8)
  cursor.y = boxY - 24

  /* ----------------------------------------------------- consent + foot */
  const consent =
    'The customer confirmed that the information provided in this form is correct and agreed to sign this ' +
    'document electronically, understanding that this electronic form has the same operational purpose as the paper form.'
  for (const line of wrap(consent, fonts.regular, 8.5, CONTENT)) {
    text(line, MARGIN, cursor.y, { size: 8.5, color: MUTED })
    cursor.y -= 11
  }

  cursor.page.drawLine({
    start: { x: MARGIN, y: MARGIN + 22 },
    end: { x: A4.width - MARGIN, y: MARGIN + 22 },
    thickness: 1,
    color: LINE,
  })
  text(
    'This document was generated electronically by the BFL BRED Group branch tablet application.',
    MARGIN,
    MARGIN + 8,
    { size: 8, color: MUTED },
  )

  return doc.save()
}

export const pdfFileName = (meta: SubmissionMeta, kind: FormData['kind']): string =>
  `${kind === 'deposit' ? 'CashDeposit' : 'CashWithdrawal'}-${meta.referenceNo}.pdf`
