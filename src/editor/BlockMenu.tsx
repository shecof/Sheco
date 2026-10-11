import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function BlockMenu({
  x,
  y,
  expanded,
  onClose,
  children,
}: {
  x: number
  y: number
  expanded: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const margin = 8
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`
    menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`
  }, [x, y, expanded])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
    }
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      closeRef.current()
    }
    const resize = () => closeRef.current()
    document.addEventListener('keydown', key)
    document.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return createPortal(
    <>
      <div className="click-away" onClick={onClose} />
      <div
        className="block-menu popover"
        ref={ref}
        aria-label="Block actions"
        style={{ left: x, top: y }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
