import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { config, isMailConfigured } from './config.js'

const subjectFor = (payload) =>
  `${payload.kind === 'deposit' ? 'Cash Deposit' : 'Cash Withdrawal'} — ${payload.accountName} — ${payload.meta.referenceNo}`

const bodyFor = (payload) => {
  const { meta } = payload
  return [
    `A ${payload.kind === 'deposit' ? 'cash deposit' : 'cash withdrawal'} form was submitted from a branch tablet.`,
    '',
    `Reference:        ${meta.referenceNo}`,
    `Account name:     ${payload.accountName}`,
    `Account number:   ${payload.accountNumber}`,
    `Amount:           ${payload.amount} ${payload.amountCurrency}`,
    `Processed by:     ${payload.processedByPhone}`,
    `Submitted at:     ${meta.submittedAt}`,
    `Branch:           ${meta.branch}`,
    `Device ID / IP:   ${meta.deviceId} / ${meta.ip}`,
    `Customer consent: ${payload.consent ? 'given electronically' : 'NOT RECORDED'}`,
    '',
    'The signed PDF is attached.',
  ].join('\n')
}

/**
 * Sends the form to it.support@bfl.la, and to the customer as well when they
 * asked for a copy of the advice. With no SMTP configured the message is
 * written to the outbox instead, so the flow can be exercised end to end.
 */
export const sendSubmission = async ({ payload, pdf, fileName }) => {
  const recipients = [config.mail.to]
  if (payload.copyToEmail) recipients.push(payload.copyToEmail)

  if (!isMailConfigured()) {
    const dir = join(config.outbox, payload.meta.referenceNo)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, fileName), pdf)
    await writeFile(
      join(dir, 'email.txt'),
      [`To: ${recipients.join(', ')}`, `Subject: ${subjectFor(payload)}`, '', bodyFor(payload)].join('\n'),
    )
    console.log(`[mail] SMTP not configured — wrote ${dir}/${fileName} for ${recipients.join(', ')}`)
    return { delivered: false, recipients, storedPath: dir }
  }

  const transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.pass },
  })

  await transport.sendMail({
    from: config.mail.from,
    to: config.mail.to,
    // The customer's own copy is a separate recipient, never disclosed to the
    // branch mailbox as a visible CC.
    bcc: payload.copyToEmail || undefined,
    subject: subjectFor(payload),
    text: bodyFor(payload),
    attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
  })

  console.log(`[mail] sent ${payload.meta.referenceNo} to ${recipients.join(', ')}`)
  return { delivered: true, recipients }
}
