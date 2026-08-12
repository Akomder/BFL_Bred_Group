import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { BRANCHES, getBranch, getDeviceId, setBranch } from '../lib/device'
import { Button, Card, Chevron, FieldLabel, selectClass } from '../components/ui'

export const SettingsScreen = ({ onClose }: { onClose: () => void }) => {
  const { t } = useI18n()
  const [branch, setBranchState] = useState(getBranch)
  const [saved, setSaved] = useState(false)
  const deviceId = getDeviceId()

  const save = () => {
    setBranch(branch)
    setSaved(true)
    setTimeout(onClose, 600)
  }

  return (
    <div className="py-4">
      <h1 className="text-2xl font-bold text-ink">{t('settingsTitle')}</h1>
      <p className="mt-2 text-base text-muted">{t('settingsBody')}</p>

      <Card className="mt-6">
        <FieldLabel htmlFor="branch">{t('branch')}</FieldLabel>
        <div className="relative">
          <select
            id="branch"
            value={branch}
            onChange={(e) => {
              setBranchState(e.target.value)
              setSaved(false)
            }}
            className={selectClass()}
          >
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <Chevron />
        </div>

        <dl className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold text-muted">{t('deviceId')}</dt>
            <dd className="mt-1 font-mono text-base text-ink">{deviceId}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">{t('ipAddress')}</dt>
            {/* Recorded per-submission on the review screen, not shown here. */}
            <dd className="mt-1 font-mono text-base text-ink">—</dd>
          </div>
        </dl>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <Button onClick={save} block>
          {saved ? t('saved') : t('save')}
        </Button>
        <Button variant="secondary" onClick={onClose} block>
          {t('back')}
        </Button>
      </div>
    </div>
  )
}
