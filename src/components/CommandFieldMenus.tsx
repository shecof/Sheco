import { useId, useRef, useState } from 'react'
import { Check, ChevronDown, Info, X } from 'lucide-react'
import { useI18n } from '../i18n'
import type { CommandParameter } from '../shared/plugins'
import { navigatePluginList } from './PluginControls'
import { Popover } from './ui'

export function CommandParameterHelp({
  label,
  description,
}: {
  label: string
  description: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  const name = `${t('Parameter help')}: ${t(label)}`
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className="icon-button command-parameter-hint"
        aria-label={name}
        title={t('Parameter help')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <Info size={13} />
      </button>
      {open && (
        <Popover anchor={anchor} className="command-help-popover" onClose={() => setOpen(false)}>
          <div id={id} role="dialog" aria-label={name}>
            <header>
              <strong>{t(label)}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Close')}
                autoFocus
                onClick={() => {
                  setOpen(false)
                  anchor.current?.focus()
                }}
              >
                <X size={14} />
              </button>
            </header>
            <p>{t(description)}</p>
          </div>
        </Popover>
      )}
    </>
  )
}

export function CommandValueSuggestions({
  parameter,
  value,
  onChoose,
}: {
  parameter: CommandParameter
  value: string
  onChoose: (value: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  const name = `${t('Quick choice')}: ${t(parameter.label)}`
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className="command-suggestions-button"
        aria-label={name}
        title={t('Quick choice')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          align="end"
          className="command-suggestions-popover"
          onClose={() => setOpen(false)}
        >
          <div id={id} role="listbox" aria-label={name} onKeyDown={navigatePluginList}>
            {parameter.choices.map((choice, index) => (
              <button
                type="button"
                role="option"
                key={index}
                aria-label={t(choice.label)}
                aria-selected={value === choice.value}
                autoFocus={index === 0}
                onClick={() => {
                  setOpen(false)
                  onChoose(choice.value)
                }}
              >
                <span>
                  <span>{t(choice.label)}</span>
                  <code>{choice.value}</code>
                </span>
                {value === choice.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
