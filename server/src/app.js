import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { config, isSheetsConfigured, mailTransports } from './config.js'
import { sendSubmission } from './mailer.js'
import { archiveSubmission } from './drive.js'
import { flushSpool, listSpool, spool } from './spool.js'
import { appendTransactionRow } from './sheets.js'

/**
 * Builds the Express app — every route, no side effects beyond that. Split
 * out from index.js so two very different entry points can share it without
 * duplicating routes: index.js (VPS/local — calls assertReady() then
 * app.listen()) and api/index.js (Vercel — exports this app directly; a
 * serverless function can't call process.exit() the way the VPS preflight
 * does on failure, so that entry point checks config differently).
 */
export const createApp = () => {
  const app = express()
  app.set('trust proxy', true)
  app.use(cors({ origin: config.allowedOrigins }))

  // Forms carry a PDF plus two images; 12 MB leaves generous headroom.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })

  const clientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for']
    const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? req.ip ?? '')
    return raw.split(',')[0].trim().replace(/^::ffff:/, '') || 'unknown'
  }

  app.get('/api/health', async (_req, res) => {
    res.json({
      ok: true,
      mail: mailTransports(),
      archive: 'drive',
      sheets: isSheetsConfigured() ? 'configured' : 'not configured',
      spoolDepth: (await listSpool()).length,
    })
  })

  /** The tablet asks for its own address so the form can record where it was filled. */
  app.get('/api/client-ip', (req, res) => res.json({ ip: clientIp(req) }))

  /** What could not be delivered, for whoever is on support. */
  app.get('/api/spool', async (_req, res) => {
    res.json({ items: await listSpool() })
  })

  /** Drains the backlog once mail is working again. */
  app.post('/api/spool/flush', async (_req, res) => {
    const results = await flushSpool(sendSubmission)
    res.json({
      attempted: results.length,
      delivered: results.filter((r) => r.delivered).length,
      results,
    })
  })

  app.post(
    '/api/submissions',
    upload.fields([
      { name: 'pdf', maxCount: 1 },
      { name: 'photo', maxCount: 1 },
      { name: 'signature', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const payload = JSON.parse(req.body.payload ?? '{}')
        const file = req.files?.pdf?.[0]
        if (!file) return res.status(400).json({ error: 'Missing pdf' })
        if (!payload.meta?.referenceNo) return res.status(400).json({ error: 'Missing meta.referenceNo' })
        if (!payload.consent) return res.status(400).json({ error: 'Consent was not recorded' })

        // The IP the client reported is advisory; the connection is the truth.
        payload.meta.ip = clientIp(req)

        const submission = { payload, pdf: file.buffer, fileName: file.originalname }

        /* Settled, not all: the customer is already waiting for the teller, so
           one channel failing must not discard the other's work — or the form. */
        const [mail, archive] = await Promise.allSettled([
          sendSubmission(submission),
          archiveSubmission(submission),
        ])

        if (archive.status === 'rejected') {
          console.error(`[archive] ${payload.meta.referenceNo} failed — ${archive.reason?.message}`)
        }

        /* sendSubmission spools its own failures. This covers the unexpected
           throw, so there is no path where an accepted form leaves no trace. */
        if (mail.status === 'rejected') {
          console.error(`[mail] ${payload.meta.referenceNo} threw — ${mail.reason?.message}`)
          await spool(submission, `unhandled: ${mail.reason?.message}`)
        }

        const mailResult = mail.status === 'fulfilled' ? mail.value : { delivered: false, spooled: true }
        const archiveResult = archive.status === 'fulfilled' ? archive.value : { archived: false }

        /* The ledger row needs the delivered/archived outcome, so it runs after
           both settle rather than alongside them. Best-effort: never blocks or
           fails the submission, whether or not Sheets is even configured. */
        const sheet = await appendTransactionRow({ payload, mail: mailResult, archive: archiveResult })

        res.json({
          referenceNo: payload.meta.referenceNo,
          delivered: mailResult.delivered,
          transport: mailResult.transport,
          recipients: mailResult.recipients,
          customerCopy: mailResult.customerCopy,
          spooled: mailResult.spooled,
          storedPath: archive.status === 'fulfilled' ? archive.value.path : mailResult.storedPath,
          archived: archiveResult.archived,
          sheetLogged: sheet.logged,
        })
      } catch (error) {
        console.error('[submissions] failed', error)
        res.status(500).json({ error: error.message })
      }
    },
  )

  return app
}
