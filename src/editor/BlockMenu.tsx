import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { Popover } from '../components/ui'

export function BlockMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
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
  }, [x, y])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
    }
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('.block-type-submenu')) return
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

type Point = { x: number; y: number }

function inCorridor(point: Point, origin: Point, target: DOMRect) {
  const edge = origin.x <= target.left ? target.left : target.right
  const a = { x: edge, y: target.top - 8 }
  const b = { x: edge, y: target.bottom + 8 }
  const cross = (p: Point, q: Point, r: Point) =>
    (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y)
  const sides = [cross(point, origin, a), cross(point, a, b), cross(point, b, origin)]
  return !(sides.some((side) => side < 0) && sides.some((side) => side > 0))
}

export function BlockSubmenu({
  label,
  icon,
  children,
  role,
  autoFocus = false,
  disabled = false,
  submenuClassName = '',
}: {
  label: string
  icon: ReactNode
  children: ReactNode
  role?: 'menuitem'
  autoFocus?: boolean
  disabled?: boolean
  submenuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const corridor = useRef<{
    origin: Point
    destination: 'trigger' | 'submenu'
    until: number
  } | null>(null)
  const keyboardFocus = useRef(false)
  const id = useId()
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const retain = () => {
    clearTimer()
    corridor.current = null
  }
  const close = () => {
    retain()
    setOpen(false)
  }
  const openWithKeyboard = () => {
    retain()
    keyboardFocus.current = !open
    setOpen(true)
    if (open) content.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }
  const leave = (point: Point, destination: 'trigger' | 'submenu') => {
    clearTimer()
    if (!open) return
    corridor.current = { origin: point, destination, until: performance.now() + 1000 }
    timer.current = setTimeout(close, 300)
  }
  useEffect(() => () => clearTimer(), [])
  useLayoutEffect(() => {
    if (open && keyboardFocus.current) {
      content.current?.querySelector<HTMLButtonElement>('button')?.focus()
      keyboardFocus.current = false
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      if (
        event.target instanceof Node &&
        (trigger.current?.contains(event.target) ||
          content.current?.parentElement?.contains(event.target))
      ) {
        retain()
        return
      }
      if (event.target instanceof Element && event.target.closest('.block-submenu-trigger')) {
        close()
        return
      }
      const path = corridor.current
      if (!path) return
      const destination =
        path.destination === 'trigger' ? trigger.current : content.current?.parentElement
      const remaining = path.until - performance.now()
      if (
        destination &&
        remaining > 0 &&
        inCorridor(
          { x: event.clientX, y: event.clientY },
          path.origin,
          destination.getBoundingClientRect(),
        )
      ) {
        clearTimer()
        timer.current = setTimeout(close, Math.min(300, remaining))
      }
    }
    document.addEventListener('pointermove', move)
    return () => document.removeEventListener('pointermove', move)
  }, [open])
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role={role}
        autoFocus={autoFocus}
        disabled={disabled}
        className={'menu-item block-submenu-trigger' + (open ? ' is-selected' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (disabled || event.pointerType !== 'mouse') return
          retain()
          timer.current = setTimeout(() => setOpen(true), 100)
        }}
        onPointerLeave={(event) => leave({ x: event.clientX, y: event.clientY }, 'submenu')}
        onClick={openWithKeyboard}
        onKeyDown={(event) => {
          if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
            event.preventDefault()
            openWithKeyboard()
          }
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronRight size={14} />
      </button>
      {open && (
        <Popover
          anchor={trigger}
          side="right"
          className={'block-type-submenu ' + submenuClassName}
          onClose={close}
        >
          <div
            id={id}
            ref={content}
            role="menu"
            aria-label={label}
            onPointerEnter={retain}
            onPointerLeave={(event) => leave({ x: event.clientX, y: event.clientY }, 'trigger')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                close()
                trigger.current?.focus()
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const items = [
                  ...(content.current?.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ) ?? []),
                ]
                const current = items.indexOf(document.activeElement as HTMLButtonElement)
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
                items[next]?.focus()
              }
            }}
          >
            {children}
          </div>
        </Popover>
      )}
    </>
  )
}
