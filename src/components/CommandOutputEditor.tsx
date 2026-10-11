import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import type { CommandOutputPreset } from '../shared/plugins'
import { PopoverPicker } from './PopoverPicker'
import { PluginActionsMenu } from './PluginControls'

function StageArguments({
  tokens,
  onChange,
}: {
  tokens: string[]
  onChange: (args: string[]) => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState(tokens.join('\n'))
  return (
    <label>
      {t('Arguments · one per line')}
      <textarea
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split('\n').filter((line) => line.length > 0))
        }}
      />
    </label>
  )
}

export function CommandOutputEditor({
  presets,
  onChange,
}: {
  presets: CommandOutputPreset[]
  onChange: (presets: CommandOutputPreset[]) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(presets[0]?.id ?? '')
  const [version, setVersion] = useState(0)
  const preset = presets.find((p) => p.id === selected) ?? presets[0]
  const edit = (patch: Partial<CommandOutputPreset>) =>
    onChange(presets.map((p) => (p.id === preset.id ? { ...p, ...patch } : p)))
  return (
    <div className="command-output-editor">
      <div className="command-output-editor-heading">
        {preset && (
          <PopoverPicker
            label={t('Output template')}
            value={preset.id}
            options={presets.map((p) => ({ value: p.id, label: t(p.label) }))}
            onChange={setSelected}
          />
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t('Add output template')}
          title={t('Add output template')}
          disabled={presets.length >= 30}
          onClick={() => {
            const id = crypto.randomUUID()
            onChange([
              ...presets,
              { id, label: t('New output template'), shell: 'posix', stages: [['grep', '/tcp']] },
            ])
            setSelected(id)
          }}
        >
          <Plus size={16} />
        </button>
        {preset && (
          <PluginActionsMenu
            label={t('Output template actions')}
            actions={[
              {
                label: t('Remove output template'),
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: () => {
                  onChange(presets.filter((p) => p.id !== preset.id))
                  setVersion((v) => v + 1)
                },
              },
            ]}
          />
        )}
      </div>
      {!preset ? (
        <p className="plugin-list-empty">{t('No output templates yet')}</p>
      ) : (
        <div key={preset.id}>
          <div className="plugin-form-grid">
            <label>
              {t('Template name')}
              <input
                value={preset.label}
                maxLength={100}
                onChange={(e) => edit({ label: e.target.value })}
              />
            </label>
            <div>
              <span className="field-label">{t('Shell')}</span>
              <PopoverPicker
                label={t('Template shell')}
                value={preset.shell}
                options={[
                  { value: 'posix', label: 'Bash / Zsh' },
                  { value: 'powershell', label: 'PowerShell 7' },
                  { value: 'any', label: t('Both shells') },
                ]}
                onChange={(shell) => edit({ shell })}
              />
            </div>
          </div>
          <p className="command-output-note">
            {t(
              'Each step receives the previous output through a pipe. Enter arguments without shell quotes; quoting is automatic.',
            )}
          </p>
          {preset.stages.map((stage, index) => (
            <section
              className="command-output-stage"
              key={`${version}:${index}`}
              aria-label={`${t('Output step')} ${index + 1}`}
            >
              <header>
                <strong>{index + 1}</strong>
                <button
                  type="button"
                  className="icon-button"
                  disabled={preset.stages.length === 1}
                  aria-label={`${t('Remove output step')}: ${index + 1}`}
                  title={t('Remove output step')}
                  onClick={() => {
                    edit({ stages: preset.stages.filter((_s, i) => i !== index) })
                    setVersion((v) => v + 1)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </header>
              <div className="plugin-form-grid">
                <label>
                  {t('Command')}
                  <input
                    value={stage[0]}
                    maxLength={500}
                    onChange={(e) =>
                      edit({
                        stages: preset.stages.map((s, i) =>
                          i === index ? [e.target.value, ...s.slice(1)] : s,
                        ),
                      })
                    }
                  />
                </label>
                <StageArguments
                  tokens={stage.slice(1)}
                  onChange={(args) =>
                    edit({
                      stages: preset.stages.map((s, i) => (i === index ? [s[0], ...args] : s)),
                    })
                  }
                />
              </div>
            </section>
          ))}
          <button
            type="button"
            className="command-add-block command-output-add"
            disabled={preset.stages.length >= 10}
            onClick={() => edit({ stages: [...preset.stages, ['sort', '-u']] })}
          >
            <Plus size={14} />
            {t('Add output step')}
          </button>
        </div>
      )}
    </div>
  )
}
