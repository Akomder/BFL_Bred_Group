import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { CopyRequestModal } from './components/CopyRequestModal'
import { StartScreen } from './screens/StartScreen'
import { FormScreen } from './screens/FormScreen'
import { PhotoScreen } from './screens/PhotoScreen'
import { SignatureScreen } from './screens/SignatureScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { DoneScreen } from './screens/DoneScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useFormStore } from './state/formStore'
import { fetchClientIp, getBranch, getDeviceId, makeReference } from './lib/device'
import { API_BASE, submitForm, type SubmitResult } from './lib/submit'
import type { SubmissionMeta } from './lib/types'

export const App = () => {
  const { step, data, goto, reset } = useFormStore()
  const [ip, setIp] = useState('…')
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submittedName, setSubmittedName] = useState('')

  useEffect(() => {
    void fetchClientIp(API_BASE).then(setIp)
  }, [])

  /* The customer signs off on the timestamp shown on the review screen, so it
     is stamped once on arrival there and then left alone — not recomputed on
     every render, and not restamped when they edit a field and come back. */
  const [meta, setMeta] = useState<SubmissionMeta | null>(null)
  useEffect(() => {
    if (step === 'review' && !meta) {
      setMeta({
        referenceNo: makeReference(),
        submittedAt: new Date().toISOString(),
        deviceId: getDeviceId(),
        branch: getBranch(),
        ip,
      })
    }
  }, [step, meta, ip])
  // A late IP lookup still lands on the form the customer has open.
  useEffect(() => {
    setMeta((current) => (current && current.ip !== ip ? { ...current, ip } : current))
  }, [ip])

  const send = async (copyToEmail?: string) => {
    if (!meta) return
    setSending(true)
    setError(undefined)
    try {
      const submission = await submitForm({ data, meta, copyToEmail })
      setResult(submission)
      setSubmittedName(data.accountName)
      setAsking(false)
      goto('done', null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const screen = () => {
    switch (step) {
      case 'start':
        return <StartScreen onSettings={() => goto('settings', null)} />
      case 'settings':
        return <SettingsScreen onClose={() => goto('start', null)} />
      case 'form':
        return <FormScreen />
      case 'photo':
        return <PhotoScreen />
      case 'signature':
        return <SignatureScreen />
      case 'review':
        return meta ? <ReviewScreen meta={meta} onSubmit={() => setAsking(true)} /> : null
      case 'done':
        return result ? (
          <DoneScreen
            customerName={submittedName}
            result={result}
            onRestart={() => {
              setResult(null)
              setMeta(null)
              reset()
            }}
          />
        ) : null
    }
  }

  return (
    <AppShell step={step} onLogoClick={step === 'start' ? undefined : () => goto('start', null)}>
      {screen()}
      <CopyRequestModal
        open={asking}
        sending={sending}
        error={error}
        onCancel={() => setAsking(false)}
        onSend={(email) => void send(email)}
      />
    </AppShell>
  )
}
