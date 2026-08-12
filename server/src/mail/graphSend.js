import { config } from '../config.js'
import { GRAPH, getGraphToken, resetGraphToken } from '../graph.js'
import { PermanentError } from '../retry.js'

/**
 * Sends through Microsoft Graph as the MAIL_FROM mailbox. Preferred over SMTP
 * because Microsoft 365 disables SMTP AUTH on most tenants, and because the
 * app registration behind the SharePoint archive can carry Mail.Send too — so
 * no mailbox password has to live in .env.
 *
 * Needs Mail.Send (application). That grant can send as any mailbox in the
 * tenant, so pair it with an Exchange application access policy limited to
 * MAIL_FROM — see the README.
 */
export const sendViaGraph = async ({ message, pdf, fileName }) => {
  const token = await getGraphToken(config.mail.graph)

  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(config.mail.from)}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(config.mail.timeouts.request),
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: 'HTML', content: message.html },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: fileName,
            contentType: 'application/pdf',
            contentBytes: pdf.toString('base64'),
          },
        ],
      },
      saveToSentItems: true,
    }),
  })

  if (res.ok) return { transport: 'graph' }

  const body = await res.text()

  // A stale cached token is the one 401 worth clearing; the next attempt then
  // fetches a fresh one rather than replaying the dead one.
  if (res.status === 401) resetGraphToken()

  const error = `Graph sendMail failed: ${res.status}`
  if (res.status === 400 || res.status === 403 || res.status === 404) {
    throw new PermanentError(error, { status: res.status, body })
  }
  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw Object.assign(new Error(error), {
      status: res.status,
      body,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
    })
  }
  throw Object.assign(new Error(error), { status: res.status, body })
}

/** Startup check: proves the credentials are accepted before a customer waits on them. */
export const verifyGraph = async () => {
  await getGraphToken(config.mail.graph)
  return true
}
