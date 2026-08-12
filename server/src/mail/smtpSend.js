import nodemailer from 'nodemailer'
import { config, isSmtpConfigured } from '../config.js'
import { PermanentError } from '../retry.js'

/* One pooled transport for the process. The previous implementation built a
   transport per submission, which paid a fresh TCP and TLS handshake every
   time; a pool keeps a couple of connections warm across a counter's day. */
let transport = null

const getTransport = () => {
  if (transport) return transport
  const { host, port, secure, user, pass } = config.mail.smtp
  const timeout = config.mail.timeouts.request

  transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  })
  return transport
}

/** Lets the tests and a config reload start from a clean pool. */
export const resetSmtpTransport = () => {
  transport?.close()
  transport = null
}

/**
 * SMTP responses split cleanly: 5xx is the server telling us this message will
 * never be accepted (unknown mailbox, rejected sender), so retrying it just
 * keeps the customer waiting. 4xx is "not now" and is worth another attempt.
 */
const classify = (error) => {
  const code = error.responseCode ?? error.code
  if (typeof code === 'number' && code >= 500 && code < 600) {
    return new PermanentError(`SMTP rejected the message: ${code}`, {
      responseCode: code,
      response: error.response,
    })
  }
  return error
}

export const sendViaSmtp = async ({ message, pdf, fileName }) => {
  try {
    await getTransport().sendMail({
      from: config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
    })
    return { transport: 'smtp' }
  } catch (error) {
    throw classify(error)
  }
}

/** Startup check: opens a connection and authenticates without sending. */
export const verifySmtp = async () => {
  if (!isSmtpConfigured()) return false
  await getTransport().verify()
  return true
}
