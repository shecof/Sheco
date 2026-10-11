import { useI18n } from '../i18n'
import { useRef, useState, useEffect, type PointerEvent, type KeyboardEvent } from 'react'
import { RotateCcw, Check, LoaderCircle } from 'lucide-react'
import { Modal } from '../components/ui'
import {
  cropPixels,
  fullCrop,
  moveCrop,
  readCrop,
  resizeCrop,
  type CropRect,
  type CropCorner,
} from '../shared/image'

const corners: { id: CropCorner; label: string }[] = [
  { id: 'nw', label: 'top left' },
  { id: 'ne', label: 'top right' },
  { id: 'sw', label: 'bottom left' },
  { id: 'se', label: 'bottom right' },
]

async function cropImage(image: HTMLImageElement, crop: CropRect): Promise<ArrayBuffer> {
  const rect = cropPixels(crop, image.naturalWidth, image.naturalHeight)
  if (rect.width > 16384 || rect.height > 16384 || rect.width * rect.height > 64_000_000)
    throw new Error('This crop is too large. Select a smaller area.')
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The image could not be processed.')
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('The crop could not be saved.'))),
        'image/png',
      )
    })
    return await blob.arrayBuffer()
  } finally {
    canvas.width = canvas.height = 0
  }
}

export function ImageCropDialog({
  src,
  initialCrop,
  onApply,
  onClose,
}: {
  src: string
  initialCrop: unknown
  onApply: (crop: CropRect, bytes: ArrayBuffer) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()

  const [crop, setCrop] = useState(() => readCrop(initialCrop))
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [available, setAvailable] = useState({ width: 740, height: 380 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const image = useRef<HTMLImageElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const liveCrop = useRef(crop)
  const drag = useRef<{
    pointer: number
    x: number
    y: number
    crop: CropRect
    kind: CropCorner | 'move'
  } | null>(null)
  liveCrop.current = crop
  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver(([entry]) =>
      setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  const scale = natural.width
    ? Math.min(available.width / natural.width, available.height / natural.height, 1)
    : 1
  const pixels = natural.width ? cropPixels(crop, natural.width, natural.height) : null
  function begin(e: PointerEvent<HTMLElement>, kind: CropCorner | 'move') {
    if (saving || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      crop: liveCrop.current,
      kind,
    }
  }
  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current,
      rect = stage.current?.getBoundingClientRect()
    if (!d || d.pointer !== e.pointerId || !rect?.width || !rect.height) return
    const dx = (e.clientX - d.x) / rect.width,
      dy = (e.clientY - d.y) / rect.height
    setCrop(d.kind === 'move' ? moveCrop(d.crop, dx, dy) : resizeCrop(d.crop, d.kind, dx, dy))
  }
  function end(e: PointerEvent<HTMLElement>, canceled = false) {
    if (drag.current?.pointer !== e.pointerId) return
    if (canceled) setCrop(drag.current.crop)
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function key(e: KeyboardEvent<HTMLElement>, kind: CropCorner | 'move') {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) ||
      saving ||
      !natural.width
    )
      return
    e.preventDefault()
    e.stopPropagation()
    const step = e.shiftKey ? 10 : 1
    const dx = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / natural.width
    const dy = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / natural.height
    setCrop(kind === 'move' ? moveCrop(crop, dx, dy) : resizeCrop(crop, kind, dx, dy))
  }
  const pointer = {
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
    onLostPointerCapture: () => {
      drag.current = null
    },
  }
  return (
    <Modal
      title={t('Crop image')}
      wide
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <div className="image-crop-dialog">
        <div className="image-crop-toolbar">
          <button
            type="button"
            className="crop-reset"
            disabled={saving || !natural.width}
            onClick={() => setCrop({ ...fullCrop })}
          >
            <RotateCcw size={14} />
            {t('Reset selection')}
          </button>
        </div>
        <div className="image-crop-viewport" ref={viewport}>
          <div
            className="image-crop-stage"
            ref={stage}
            style={
              natural.width
                ? {
                    width: natural.width * scale,
                    height: natural.height * scale,
                  }
                : undefined
            }
          >
            <img
              ref={image}
              src={src}
              crossOrigin="anonymous"
              alt="Original image for cropping"
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setError(t('The original image could not be opened.'))}
            />
            {!!natural.width && (
              <div
                className="image-crop-selection"
                role="button"
                tabIndex={0}
                aria-label={t('Move crop selection')}
                aria-disabled={saving}
                style={{
                  left: crop.x * 100 + '%',
                  top: crop.y * 100 + '%',
                  width: crop.width * 100 + '%',
                  height: crop.height * 100 + '%',
                }}
                onPointerDown={(e) => begin(e, 'move')}
                onKeyDown={(e) => key(e, 'move')}
                {...pointer}
              >
                <div className="crop-grid" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                {corners.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={'crop-corner ' + id}
                    aria-label={t('Resize crop ') + t(label)}
                    disabled={saving}
                    onPointerDown={(e) => begin(e, id)}
                    onKeyDown={(e) => key(e, id)}
                    {...pointer}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="image-crop-details">
          <output aria-label={t('Crop dimensions')}>
            {pixels ? `${pixels.width} × ${pixels.height} px` : t('Loading image…')}
          </output>
        </div>
        {error && (
          <p className="crop-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="button" type="button" disabled={saving} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !natural.width}
            onClick={async () => {
              if (!image.current) return
              setSaving(true)
              setError('')
              try {
                await onApply(crop, await cropImage(image.current, crop))
              } catch (e) {
                setError(e instanceof Error ? e.message : t('The crop could not be saved.'))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            {saving ? t('Applying…') : t('Apply crop')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
