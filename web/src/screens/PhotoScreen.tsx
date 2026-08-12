import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useFormStore } from '../state/formStore'
import { Button, Card } from '../components/ui'

type CameraState = 'starting' | 'live' | 'blocked'

/** Long edge of the stored photo — enough for the PDF, small enough to email. */
const MAX_EDGE = 900

export const PhotoScreen = () => {
  const { t } = useI18n()
  const { data, patch, advance, goto, returnTo } = useFormStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>('starting')
  const [facing, setFacing] = useState<'user' | 'environment'>('user')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    stop()
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setState('live')
    } catch {
      // No camera, no permission, or an insecure origin — the flow continues
      // without a photo so a demo on a laptop is never blocked.
      setState('blocked')
    }
  }, [facing, stop])

  useEffect(() => {
    if (!data.photo) void start()
    return stop
  }, [data.photo, start, stop])

  const capture = () => {
    const video = videoRef.current
    if (!video) return
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (facing === 'user') {
      // Un-mirror the preview so the saved photo reads the right way round.
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    patch({ photo: canvas.toDataURL('image/jpeg', 0.85) })
    stop()
  }

  const retake = () => {
    patch({ photo: null })
    void start()
  }

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">{t('photoTitle')}</h1>
      <p className="mt-2 text-base text-muted">{t('photoSubtitle')}</p>

      <Card className="mt-5">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-[520px] overflow-hidden rounded-2xl bg-ink/90">
          {data.photo ? (
            <img src={data.photo} alt={t('customerPhoto')} className="h-full w-full object-cover" />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className={`h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
              />
              {state !== 'live' && (
                <div className="absolute inset-0 flex items-center justify-center bg-ink/80 p-6 text-center text-sm text-white">
                  {state === 'starting' ? t('cameraStarting') : t('cameraBlocked')}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {data.photo ? (
            <Button variant="secondary" onClick={retake}>
              {t('retake')}
            </Button>
          ) : (
            <>
              <Button onClick={capture} disabled={state !== 'live'}>
                {t('takePhoto')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
                disabled={state === 'blocked'}
              >
                {t('switchCamera')}
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <Button onClick={advance} block>
          {returnTo === 'review' ? t('saveAndReturn') : data.photo ? t('usePhoto') : t('continue')}
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => goto(returnTo === 'review' ? 'review' : 'form', null)}
        >
          {t('back')}
        </Button>
      </div>
    </div>
  )
}
