import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import multer from 'multer'
<<<<<<< HEAD
import { config, isLedgerConfigured, mailTransports } from './config.js'
=======
import rateLimit from 'express-rate-limit'
import { config, isSheetsConfigured, mailTransports } from './config.js'
>>>>>>> 94a5d5c083615b9f9dc9a62fc00bb42c294961ac
import { sendSubmission } from './mailer.js'
import { archiveSubmission } from './archive.js'
import { flushSpool, listSpool, spool } from './spool.js'
<<<<<<< HEAD
import { appendTransactionRow } from './excel.js'
=======
import { appendTransactionRow } from './sheets.js'
import { requireDeviceKey, requireAdminKey, hasAdminKey } from './auth.js'
import { isSafeReference, safeFileName, isValidEmail, looksLikePdf } from './validate.js'
>>>>>>> 94a5d5c083615b9f9dc9a62fc00bb42c294961ac

/**
 * Builds the Express app — every route, no side effects beyond that. Split
 * out from index.js so two very different entry points can share it without
 * duplicating routes: index.js (VPS/local — calls assertReady() then
 * app.listen()) and api/index.js (Vercel — exports this app directly; a
 * serverless function can't call process.exit() the way the VPS preflight
 * does on failure, so that entry point checks config differently).
 *
 * Every route below is authenticated (auth.js) and rate limited. CORS is
 * still configured, but it is a browser convenience, not a control: it never
 * stopped a scripted client, which is why the credential checks exist.
 */
export const createApp = () => {
  const app = express()

  /* How much of X-Forwarded-For to believe. Configurable and defaulting to
     "none" — see config.js. The recorded IP ends up in the audit mail and the
     ledger, so trusting every hop meant the caller could pick it. */
  app.set('trust proxy', config.trustProxy)
  app.disable('x-powered-by')

  app.use(helmet())
  app.use(cors({ origin: config.allowedOrigins }))

  const limit = (max) =>
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    })

  // Forms carry a PDF plus two images; 12 MB leaves generous headroom.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 3, fields: 10, fieldSize: 256 * 1024 },
  })

  /* Express resolves this against the `trust proxy` setting above, so it is
     the connection address unless a proxy we chose to trust rewrote it. */
  const clientIp = (req) => (req.ip ?? '').replace(/^::ffff:/, '') || 'unknown'

  /**
   * Anonymous callers get liveness only. Transport list, Sheets state and
   * spool depth are reconnaissance — they describe how the service is wired
   * and how much work is backed up — so they need the admin key.
   */
  app.get('/api/health', limit(config.rateLimit.general), async (req, res) => {
    if (!hasAdminKey(req)) return res.json({ ok: true })

    res.json({
      ok: true,
      mail: mailTransports(),
      archive: 'sharepoint',
      ledger: isLedgerConfigured() ? 'configured' : 'not configured',
      spoolDepth: (await listSpool()).length,
    })
  })

  /** The tablet asks for its own address so the form can record where it was filled. */
  app.get('/api/client-ip', limit(config.rateLimit.general), requireDeviceKey, (req, res) =>
    res.json({ ip: clientIp(req) }),
  )

  /** What could not be delivered, for whoever is on support. */
  app.get('/api/spool', limit(config.rateLimit.general), requireAdminKey, async (_req, res) => {
    res.json({ items: await listSpool() })
  })

  /** Drains the backlog once mail is working again. */
  app.post('/api/spool/flush', limit(config.rateLimit.general), requireAdminKey, async (_req, res) => {
    const results = await flushSpool(sendSubmission)
    res.json({
      attempted: results.length,
      delivered: results.filter((r) => r.delivered).length,
      results,
    })
  })

  app.post(
    '/api/submissions',
    limit(config.rateLimit.submissions),
    requireDeviceKey,
    upload.fields([
      { name: 'pdf', maxCount: 1 },
      { name: 'photo', maxCount: 1 },
      { name: 'signature', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        let payload
        try {
          payload = JSON.parse(req.body.payload ?? '{}')
        } catch {
          return res.status(400).json({ error: 'Malformed payload' })
        }
        if (!payload || typeof payload !== 'object' || typeof payload.meta !== 'object' || !payload.meta) {
          return res.status(400).json({ error: 'Malformed payload' })
        }

        const file = req.files?.pdf?.[0]
        if (!file) return res.status(400).json({ error: 'Missing pdf' })

        /* The reference becomes a spool directory name, so it has to be a
           single safe path segment before anything touches the filesystem
           with it — see validate.js and spool.js. */
        if (!isSafeReference(payload.meta.referenceNo)) {
          return res.status(400).json({ error: 'Missing or invalid meta.referenceNo' })
        }
        if (!payload.consent) return res.status(400).json({ error: 'Consent was not recorded' })
        if (!looksLikePdf(file.buffer)) return res.status(400).json({ error: 'Uploaded file is not a PDF' })

        /* An unchecked address here is an open relay: the customer copy goes
           out over the branch's authenticated SMTP account, from the bank's
           own sending domain. Reject a bad one rather than sending anyway. */
        if (payload.copyToEmail != null && payload.copyToEmail !== '') {
          if (!isValidEmail(payload.copyToEmail)) {
            return res.status(400).json({ error: 'Invalid copyToEmail address' })
          }
        } else {
          payload.copyToEmail = null
        }

        // The IP the client reported is advisory; the connection is the truth.
        payload.meta.ip = clientIp(req)

        /* The client's filename is advisory too — it is attacker-controlled
           and used as a spool filename, so it never reaches a path as sent. */
        const fileName = safeFileName(file.originalname, `${payload.meta.referenceNo}.pdf`)
        const submission = { payload, pdf: file.buffer, fileName }

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
           fails the submission, whether or not the ledger is even configured. */
        const ledger = await appendTransactionRow({ payload, mail: mailResult, archive: archiveResult })

        res.json({
          referenceNo: payload.meta.referenceNo,
          delivered: mailResult.delivered,
          transport: mailResult.transport,
          recipients: mailResult.recipients,
          customerCopy: mailResult.customerCopy,
          spooled: mailResult.spooled,
          storedPath: archive.status === 'fulfilled' ? archive.value.path : mailResult.storedPath,
          archived: archiveResult.archived,
          ledgerLogged: ledger.logged,
        })
      } catch (error) {
        /* Logged in full, reported as a generic failure: the raw message can
           carry upstream Drive/SMTP response text and internal detail, and
           the tablet has no use for either. */
        console.error('[submissions] failed', error)
        res.status(500).json({ error: 'Submission could not be processed' })
      }
    },
  )

  /* Multer rejects an oversized or malformed upload by calling next(err);
     without a handler Express would answer with an HTML stack page. */
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      console.warn(`[upload] rejected — ${error.code}`)
      return res.status(400).json({ error: 'Upload rejected' })
    }
    console.error('[server] unhandled', error)
    res.status(500).json({ error: 'Internal error' })
  })

  return app
}
