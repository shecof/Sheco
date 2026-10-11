import { useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './ui'

// Shared by database fields and diagram properties; labels arrive translated.
export function PopoverPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  popoverClassName = '',
}: {
  label: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
  className?: string
  popoverClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={'database-picker ' + className}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {selected?.icon}
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          className={'database-picker-popover ' + popoverClassName}
          onClose={() => setOpen(false)}
        >
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            onKeyDown={(event) => {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
              ]
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'ArrowDown'
                  ? (index + 1) % buttons.length
                  : event.key === 'ArrowUp'
                    ? (index + buttons.length - 1) % buttons.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : -1
              if (next < 0) return
              event.preventDefault()
              buttons[next]?.focus()
            }}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                autoFocus={option.value === value || (!selected && index === 0)}
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  anchor.current?.focus()
                }}
              >
                {option.icon}
                <span>{option.label}</span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
