import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useFormStore } from '../state/formStore'
import { Button, Card } from '../components/ui'

type Stroke = { x: number; y: number }[]

/**
 * Signature pad on a transparent canvas. Pointer Events cover stylus, finger
 * and mouse in one path, and strokes are kept as points so Undo can drop the
 * last one and the canvas can be redrawn on resize without losing the signature.
 */
export const SignatureScreen = () => {
  const { t } = useI18n()
  const { data, patch, advance, goto, returnTo } = useFormStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef<Stroke | null>(null)
  const [hasInk, setHasInk] = useState(Boolean(data.signature))

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineWidth = 2.5 * (window.devicePixelRatio || 1)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f2a3d'
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y)
      // A single tap still leaves a visible dot.
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y)
      ctx.stroke()
    }
  }, [])

  // Match the backing store to the CSS size so strokes are sharp on retina.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      redraw()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Stroke[number] => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ratio = canvas.width / rect.width
    return { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = [pointFrom(e)]
    strokesRef.current.push(drawingRef.current)
    setHasInk(true)
    redraw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current.push(pointFrom(e))
    redraw()
  }

  const endStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = null
    save()
  }

  const save = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    patch({ signature: strokesRef.current.length ? canvas.toDataURL('image/png') : null })
  }

  const clear = () => {
    strokesRef.current = []
    setHasInk(false)
    redraw()
    patch({ signature: null })
  }

  const undo = () => {
    strokesRef.current.pop()
    setHasInk(strokesRef.current.length > 0)
    redraw()
    save()
  }

  return (
    <div className="pb-4">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">{t('signatureTitle')}</h1>
      <p className="mt-2 text-base text-muted">{t('signatureSubtitle')}</p>

      <Card className="mt-5">
        <div className="relative rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/60">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
            className="h-[240px] w-full touch-none sm:h-[280px]"
          />
          {!hasInk && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-medium text-brand-300">
              {t('signHere')}
            </span>
          )}
          <div className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-brand-200" />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={undo} disabled={!hasInk}>
            {t('undo')}
          </Button>
          <Button variant="secondary" onClick={clear} disabled={!hasInk}>
            {t('clear')}
          </Button>
        </div>
      </Card>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <Button onClick={advance} block disabled={!hasInk}>
          {returnTo === 'review' ? t('saveAndReturn') : t('continue')}
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => goto(returnTo === 'review' ? 'review' : 'photo', null)}
        >
          {t('back')}
        </Button>
      </div>
    </div>
  )
}
