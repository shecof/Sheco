import { useId, useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { useI18n } from '../i18n'
import type { CommandParameter } from '../shared/plugins'
import { navigatePluginList } from './PluginControls'
import { Popover } from './ui'

export function CommandParameterMenu({
  parameters,
  anchor,
  onAdd,
}: {
  parameters: CommandParameter[]
  anchor: RefObject<HTMLButtonElement | null>
  onAdd: (id: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const id = useId()
  const groups = [...new Set(parameters.map((p) => p.group))]
  return (
    <>
      <button
        ref={anchor}
        className="command-add-block"
        aria-label={t('Add parameter')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={!parameters.length}
        title={!parameters.length ? t('All parameters added') : undefined}
        onClick={() => setOpen(!open)}
      >
        <Plus size={23} />
        <span>{t('Add parameter')}</span>
      </button>
      {open && (
        <Popover anchor={anchor} className="command-add-popover" onClose={() => setOpen(false)}>
          <div
            className="command-add-options"
            id={id}
            role="menu"
            aria-label={t('Add parameter')}
            onKeyDown={navigatePluginList}
          >
            {groups.map((group) => (
              <div key={group} role="group" aria-label={t(group)}>
                <h3>{t(group)}</h3>
                {parameters
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <button
                      role="menuitem"
                      key={p.id}
                      aria-label={t(p.label)}
                      title={t(p.description)}
                      autoFocus={p.id === parameters[0].id}
                      onClick={() => {
                        setOpen(false)
                        anchor.current?.focus()
                        onAdd(p.id)
                      }}
                    >
                      <Plus size={13} />
                      <span>{t(p.label)}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
