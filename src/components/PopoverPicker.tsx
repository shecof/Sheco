import { useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './ui'
import { useI18n } from '../i18n'

// Shared by database fields and diagram properties; labels arrive translated.
export function PopoverPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
  popoverClassName = '',
  searchPlaceholder,
  selectedLabel,
  iconOnly = false,
}: {
  label: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
  className?: string
  popoverClassName?: string
  searchPlaceholder?: string
  selectedLabel?: ReactNode
  iconOnly?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)
  const visibleOptions = searchPlaceholder
    ? options.filter((option) =>
        option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
      )
    : options
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={'database-picker ' + className + (iconOnly ? ' icon-only-picker' : '')}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setQuery('')
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setQuery('')
            setOpen(true)
          }
        }}
      >
        {!iconOnly && selected?.icon}
        <span>{selectedLabel ?? selected?.label ?? value}</span>
        {!iconOnly && <ChevronDown size={13} />}
      </button>
      {open && (
        <Popover
          anchor={anchor}
          className={'database-picker-popover ' + popoverClassName}
          onClose={() => setOpen(false)}
        >
          {searchPlaceholder && (
            <input
              className="database-picker-search"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                  event.preventDefault()
                  const buttons = [
                    ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
                  ]
                  buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus()
                } else if (event.key === 'Enter' && visibleOptions[0]) {
                  event.preventDefault()
                  onChange(visibleOptions[0].value)
                  setOpen(false)
                  anchor.current?.focus()
                }
              }}
            />
          )}
          <div
            id={listId}
            ref={list}
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
            {visibleOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                autoFocus={
                  !searchPlaceholder && (option.value === value || (!selected && index === 0))
                }
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
            {!visibleOptions.length && <p className="picker-empty">{t('No matches.')}</p>}
          </div>
        </Popover>
      )}
    </>
  )
}

// An editable choice keeps focus in one input for both suggestions and custom text.
export function EditablePopoverPicker({
  label,
  value,
  options,
  onChange,
  placeholder,
  maxLength,
  popoverClassName = '',
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  popoverClassName?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const visible = options.filter((option) =>
    option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  const expanded = open && visible.length > 0
  const show = () => {
    setQuery('')
    setActive(null)
    setOpen(true)
  }
  const choose = (option: string) => {
    onChange(option)
    setOpen(false)
    input.current?.focus()
  }
  return (
    <>
      <div className="editable-picker">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && active !== null ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          value={value}
          onFocus={show}
          onClick={show}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onChange(event.target.value)
            setQuery(event.target.value)
            setActive(null)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              if (visible.length)
                setActive((index) =>
                  index === null
                    ? event.key === 'ArrowDown'
                      ? 0
                      : visible.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) %
                      visible.length,
                )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (expanded && active !== null && visible[active]) choose(visible[active])
              else setOpen(false)
            } else if (event.key === 'Tab') setOpen(false)
          }}
        />
        <ChevronDown size={13} aria-hidden="true" />
      </div>
      {expanded && (
        <Popover
          anchor={input}
          className={'database-picker-popover editable-picker-options ' + popoverClassName}
          onClose={() => setOpen(false)}
        >
          <div id={listId} role="listbox" aria-label={label}>
            {visible.map((option, index) => (
              <button
                key={option}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option === value}
                className={active === index ? 'is-active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span>{option}</span>
                {option === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
