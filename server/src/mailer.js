import { config, mailTransports } from './config.js'
import { withRetry } from './retry.js'
import { internalMessage, customerMessage } from './mail/messages.js'
import { sendViaGraph, verifyGraph } from './mail/graphSend.js'
import { sendViaSmtp, verifySmtp } from './mail/smtpSend.js'
import { spool } from './spool.js'

const SENDERS = { graph: sendViaGraph, smtp: sendViaSmtp }

/**
 * Sends one message, trying each configured transport in order and retrying
 * the transient failures within each. Graph being down should fall through to
 * the SMTP relay rather than fail the send — that is the point of configuring both.
 */
const deliver = async ({ message, pdf, fileName, label }) => {
  const transports = mailTransports()
  if (transports.length === 0) throw new Error('No mail transport configured')

  const failures = []

  for (const name of transports) {
    try {
      const result = await withRetry(() => SENDERS[name]({ message, pdf, fileName }), {
        attempts: config.mail.retry.attempts,
        baseDelayMs: config.mail.retry.baseDelayMs,
        onRetry: (error, attempt, delay) =>
          console.warn(
            `[mail] ${label} via ${name} attempt ${attempt} failed (${error.message}); retrying in ${Math.round(delay)}ms`,
          ),
      })
      return result
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      console.error(`[mail] ${label} via ${name} gave up — ${error.message}`)
    }
  }

  throw new Error(failures.join(' | '))
}

/**
 * Sends the completed form.
 *
 * Two separate messages go out: the audit record to it.support@bfl.la, and —
 * only when the customer asked for it — their own advice, which deliberately
 * omits the Device ID, IP and consent audit line.
 *
 * Assumes a transport is configured — the boot preflight (preflight.js)
 * refuses to start the service otherwise. Never throws even so: the customer
 * has already been told to wait for the teller, so an undeliverable form is
 * spooled to disk and reported, not lost.
 */
export const sendSubmission = async ({ payload, pdf, fileName }) => {
  const internal = internalMessage(payload)
  const customer = payload.copyToEmail ? customerMessage(payload) : null
  const recipients = [config.mail.to, ...(customer ? [payload.copyToEmail] : [])]

  // The internal copy is the one that matters operationally.
  let delivery
  try {
    delivery = await deliver({ message: internal, pdf, fileName, label: 'internal' })
  } catch (error) {
    const { path } = await spool({ payload, pdf, fileName }, error.message)
    console.error(
      `[mail] ${payload.meta.referenceNo} could not be delivered — spooled to ${path}. Flush with POST /api/spool/flush`,
    )
    return { delivered: false, spooled: true, recipients, reason: error.message, storedPath: path }
  }

  /* The customer's copy is best effort. They typed their own address on a
     tablet, and a typo there must not fail a deposit that has already been
     accepted and archived. */
  let customerCopy
  if (customer) {
    try {
      await deliver({ message: customer, pdf, fileName, label: 'customer' })
      customerCopy = { sent: true, to: payload.copyToEmail }
    } catch (error) {
      console.error(`[mail] customer copy to ${payload.copyToEmail} failed — ${error.message}`)
      customerCopy = { sent: false, to: payload.copyToEmail, error: error.message }
    }
  }

  console.log(
    `[mail] sent ${payload.meta.referenceNo} to ${config.mail.to} via ${delivery.transport}` +
      (customerCopy ? ` (customer copy ${customerCopy.sent ? 'sent' : 'FAILED'})` : ''),
  )

  return { delivered: true, spooled: false, transport: delivery.transport, recipients, customerCopy }
}

/**
 * Startup check, so a wrong secret shows up in the launch log rather than at
 * the counter. Never throws itself — each transport's result is reported
 * individually — but preflight.js treats any failure here as fatal and
 * refuses to boot, since a form no transport can send has nowhere to go but
 * the spool for every single submission until someone notices.
 */
export const verifyMailConfig = async () => {
  const results = {}
  for (const name of mailTransports()) {
    try {
      await (name === 'graph' ? verifyGraph() : verifySmtp())
      results[name] = 'ok'
    } catch (error) {
      results[name] = `FAILED — ${error.message}`
    }
  }
  return results
}
