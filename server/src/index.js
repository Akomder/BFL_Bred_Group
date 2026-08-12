import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { config, isMailConfigured, isSharePointConfigured } from './config.js'
import { sendSubmission } from './mailer.js'
import { archiveSubmission } from './archive.js'

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mail: isMailConfigured() ? 'smtp' : 'outbox',
    archive: isSharePointConfigured() ? 'sharepoint' : 'outbox',
  })
})

/** The tablet asks for its own address so the form can record where it was filled. */
app.get('/api/client-ip', (req, res) => res.json({ ip: clientIp(req) }))

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
      const [mail, archive] = await Promise.all([
        sendSubmission(submission),
        archiveSubmission(submission),
      ])

      res.json({
        referenceNo: payload.meta.referenceNo,
        delivered: mail.delivered,
        recipients: mail.recipients,
        storedPath: archive.path,
        archived: archive.archived,
      })
    } catch (error) {
      console.error('[submissions] failed', error)
      res.status(500).json({ error: error.message })
    }
  },
)

app.listen(config.port, () => {
  console.log(`BFL cash form service listening on :${config.port}`)
  console.log(`  mail    -> ${isMailConfigured() ? `SMTP ${config.mail.host}` : `outbox (${config.outbox})`}`)
  console.log(`  archive -> ${isSharePointConfigured() ? 'SharePoint' : `outbox (${config.outbox})`}`)
  console.log(`  forms are always sent to ${config.mail.to}`)
})
