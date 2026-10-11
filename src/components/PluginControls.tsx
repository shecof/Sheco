import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Popover } from './ui'

export function navigatePluginList(event: KeyboardEvent<HTMLElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? Math.min(index + 1, buttons.length - 1)
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? Math.max(index - 1, 0)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : -1
  if (next < 0) return
  event.preventDefault()
  buttons[next]?.focus()
}

export function PluginActionsMenu({
  label,
  actions,
}: {
  label: string
  actions: {
    label: string
    icon: ReactNode
    onClick: () => void
    disabled?: boolean
    danger?: boolean
  }[]
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          align="end"
          className="plugin-actions-menu"
          onClose={() => setOpen(false)}
        >
          <div
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={(event) => {
              const nodes = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ]
              const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'ArrowDown'
                  ? (index + 1) % nodes.length
                  : event.key === 'ArrowUp'
                    ? (index + nodes.length - 1) % nodes.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? nodes.length - 1
                        : -1
              if (next >= 0) {
                event.preventDefault()
                nodes[next]?.focus()
              }
            }}
          >
            {actions.map((action, index) => (
              <button
                type="button"
                role="menuitem"
                key={action.label}
                className={'menu-item' + (action.danger ? ' danger' : '')}
                disabled={action.disabled}
                autoFocus={index === actions.findIndex((item) => !item.disabled)}
                onClick={() => {
                  setOpen(false)
                  anchor.current?.focus()
                  action.onClick()
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
