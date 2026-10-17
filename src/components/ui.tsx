import { useI18n } from '../i18n'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  useContext,
  createContext,
  type ReactNode,
  type RefObject,
  type ButtonHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  FileText,
  Table2,
  Wrench,
  Folder,
  Shield,
  NotebookPen,
  Layers,
  GraduationCap,
  Sparkles,
  ChevronDown,
  Network,
  Check,
} from 'lucide-react'
const PopoverOwners = createContext<string[]>([])
const popoverLayers: string[] = []
export function PageIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const icons: Record<string, typeof FileText> = {
    file: FileText,
    network: Network,
    table: Table2,
    wrench: Wrench,
    folder: Folder,
    shield: Shield,
    notebook: NotebookPen,
    layers: Layers,
    graduation: GraduationCap,
    sparkles: Sparkles,
  }
  const Icon = icons[icon]
  return Icon ? (
    <Icon size={size} strokeWidth={1.7} />
  ) : (
    <span className="page-emoji" style={{ fontSize: size }}>
      {icon}
    </span>
  )
}
export function IconButton({
  children,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  const { t, language } = useI18n()

  return (
    <button className="icon-button" type="button" aria-label={t(title)} title={t(title)} {...props}>
      {children}
    </button>
  )
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  headerActions,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
  headerActions?: ReactNode
}) {
  const { t, language } = useI18n()

  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    const controls = () =>
      [
        ...[ref.current, ...document.querySelectorAll<HTMLElement>('[data-popover-modal]')]
          .filter(
            (scope) =>
              scope && (scope === ref.current || scope.dataset.popoverModal === ref.current?.id),
          )
          .flatMap((scope) => [
            ...scope!.querySelectorAll<HTMLElement>('input,button,select,textarea,[tabindex]'),
          ]),
      ].filter(
        (node) =>
          !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length > 0,
      )
    const firstControl =
      controls().find((node) => node.hasAttribute('data-autofocus')) ??
      controls().find((node) => node.matches('input,textarea,select')) ??
      controls()[0]
    firstControl?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popoverLayers.length) return
        e.stopPropagation()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const nodes = controls()
        const first = nodes[0]
        const last = nodes.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => {
      document.removeEventListener('keydown', handler, true)
      prior?.focus()
    }
  }, [])
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        id={`modal-${id}`}
        className={'modal ' + (wide ? 'wide ' : '') + className}
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
      >
        <header>
          <h2>{t(title)}</h2>
          {headerActions}
          <IconButton title={t('Close')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  )
}
export function Popover({
  children,
  onClose,
  className = '',
  anchor,
  align = 'start',
  side = 'bottom',
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  anchor?: RefObject<HTMLElement | null>
  align?: 'start' | 'end'
  side?: 'bottom' | 'right'
}) {
  const { t, language } = useI18n()

  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const parents = useContext(PopoverOwners)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const trigger = anchor?.current
    const menu = ref.current
    const owner =
      trigger?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') ??
      document.getElementById(
        trigger?.closest<HTMLElement>('[data-popover-modal]')?.dataset.popoverModal ?? '',
      )
    if (!menu || !owner) return
    // Portals must remain part of the modal's accessibility and keyboard scope.
    menu.dataset.popoverModal = owner.id
    const own = () => (owner.getAttribute('aria-owns') ?? '').split(' ').filter(Boolean)
    owner.setAttribute('aria-owns', [...own(), menu.id].join(' '))
    return () => {
      const remaining = own()
        .filter((value) => value !== menu.id)
        .join(' ')
      if (remaining) owner.setAttribute('aria-owns', remaining)
      else owner.removeAttribute('aria-owns')
    }
  }, [anchor, id])

  useLayoutEffect(() => {
    if (!anchor) return
    const menu = ref.current
    const trigger = anchor.current
    if (!menu || !trigger) return
    let frame = 0
    const place = () => {
      frame = 0
      const rect = trigger.getBoundingClientRect()
      let visible = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX)
        const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY)
        if (clipsX || clipsY) {
          const bounds = parent.getBoundingClientRect()
          visible = {
            left: clipsX ? Math.max(visible.left, bounds.left) : visible.left,
            right: clipsX ? Math.min(visible.right, bounds.right) : visible.right,
            top: clipsY ? Math.max(visible.top, bounds.top) : visible.top,
            bottom: clipsY ? Math.min(visible.bottom, bounds.bottom) : visible.bottom,
          }
        }
      }
      if (
        rect.bottom <= visible.top ||
        rect.top >= visible.bottom ||
        rect.right <= visible.left ||
        rect.left >= visible.right
      ) {
        closeRef.current()
        return
      }
      const margin = 8
      const gap = 4
      if (side === 'right') {
        menu.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`
        const { width, height } = menu.getBoundingClientRect()
        const right = rect.right + gap
        const left = rect.left - gap - width
        const x = right + width <= window.innerWidth - margin || left < margin ? right : left
        menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`
        menu.style.top = `${Math.max(margin, Math.min(rect.top, window.innerHeight - height - margin))}px`
        return
      }
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const naturalHeight = Math.max(menu.scrollHeight + 2, menu.offsetHeight)
      const flip = naturalHeight > below && above > below
      menu.style.maxHeight = `${Math.max(0, flip ? above : below)}px`
      const { width, height } = menu.getBoundingClientRect()
      const x = align === 'end' ? rect.right - width : rect.left
      const y = flip ? rect.top - gap - height : rect.bottom + gap
      menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`
      menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place)
    }
    place()
    const observer = new ResizeObserver(schedule)
    observer.observe(menu)
    observer.observe(trigger)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [anchor, align, side])

  useEffect(() => {
    popoverLayers.push(id)
    const outside = (e: PointerEvent) => {
      const insideChild = e
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement && node.dataset.popoverOwners?.split(' ').includes(id),
        )
      if (
        !insideChild &&
        !ref.current?.contains(e.target as Node) &&
        !anchor?.current?.contains(e.target as Node)
      )
        closeRef.current()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popoverLayers.at(-1) !== id) return
        e.preventDefault()
        e.stopImmediatePropagation()
        const trigger = anchor?.current
        if (trigger?.matches('button,input,[tabindex]')) trigger.focus()
        else trigger?.querySelector<HTMLElement>('button')?.focus()
        closeRef.current()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    return () => {
      popoverLayers.splice(popoverLayers.indexOf(id), 1)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, id])
  const content = (
    <PopoverOwners.Provider value={[...parents, id]}>
      <div
        id={`popover-${id}`}
        className={'popover ' + className + (anchor ? ' anchored-popover' : '')}
        ref={ref}
        data-popover-owners={[...parents, id].join(' ')}
        onClick={anchor ? (e) => e.stopPropagation() : undefined}
      >
        {children}
      </div>
    </PopoverOwners.Provider>
  )
  return anchor ? createPortal(content, document.body) : content
}
export function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
  shortcut,
  selected,
  role,
}: {
  icon?: ReactNode
  children: ReactNode
  onClick: () => void
  danger?: boolean
  shortcut?: string
  selected?: boolean
  role?: 'menuitem'
}) {
  const { t, language } = useI18n()

  return (
    <button
      type="button"
      role={role}
      className={'menu-item ' + (danger ? 'danger' : '') + (selected ? ' is-selected' : '')}
      aria-pressed={selected}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
      {selected && <Check className="menu-selected-check" size={15} />}
    </button>
  )
}
export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  const { t, language } = useI18n()

  return (
    <label className="select-wrap">
      <select aria-label={t(label)} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  )
}
