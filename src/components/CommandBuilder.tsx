import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, RotateCcw, Search, Settings2, Terminal, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import {
  buildCommand,
  type CommandValues,
  type CommandShell,
  type CommandParameter,
} from '../shared/plugins'
import { PopoverPicker } from './PopoverPicker'
import { PluginActionsMenu, navigatePluginList } from './PluginControls'
import { CommandParameterMenu } from './CommandParameterMenu'
import { CommandParameterHelp, CommandValueSuggestions } from './CommandFieldMenus'

export function CommandBuilder({ onSettings }: { onSettings: () => void }) {
  const { w, run, notify } = useApp()
  const { t } = useI18n()
  const config = w!.plugins.commandBuilder.config
  const [selected, setSelected] = useState(
    config.tools.find((tool) => tool.id === 'nmap')?.id ?? config.tools[0].id,
  )
  const [shell, setShell] = useState<CommandShell>(
    window.sheco.platform === 'win32' ? 'powershell' : 'posix',
  )
  const [drafts, setDrafts] = useState<Record<string, CommandValues>>({})
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [toolQuery, setToolQuery] = useState('')
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [focusTarget, setFocusTarget] = useState('')
  const fields = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  const tool = config.tools.find((tool) => tool.id === selected) ?? config.tools[0]
  const stored = Object.hasOwn(drafts, tool.id) ? drafts[tool.id] : undefined
  const values = Object.fromEntries(
    tool.parameters.map((p) => [
      p.id,
      stored && Object.hasOwn(stored, p.id) ? stored[p.id] : { enabled: p.required, value: '' },
    ]),
  ) as CommandValues
  const outputKey = `${tool.id}:${shell}`
  const outputPresetId = Object.hasOwn(outputs, outputKey) ? outputs[outputKey] : ''
  const outputPresets = tool.outputPresets.filter(
    (preset) => preset.shell === 'any' || preset.shell === shell,
  )
  const result = buildCommand(tool, values, shell, outputPresetId)
  // Old values must not acquire a different meaning after editing/importing definitions.
  useEffect(() => {
    setDrafts({})
    setOutputs({})
    setTouched(new Set())
  }, [config])
  useEffect(() => {
    if (!focusTarget) return
    if (focusTarget === '@add' || focusTarget === '@tool') {
      const control =
        focusTarget === '@add'
          ? addButton.current
          : fields.current?.querySelector<HTMLButtonElement>('.command-tool-picker')
      control?.focus({ preventScroll: true })
      setFocusTarget('')
      return
    }
    const card = document.getElementById(`${id}-${focusTarget}`)
    card?.scrollIntoView({ block: 'nearest' })
    const control =
      card?.querySelector<HTMLElement>(
        '.command-parameter-value input, .command-parameter-value textarea, .command-parameter-value button',
      ) ??
      card?.querySelector<HTMLElement>('input[type="checkbox"]') ??
      card
    control?.focus({ preventScroll: true })
    setFocusTarget('')
  }, [focusTarget, id])
  const change = (parameterId: string, patch: Partial<CommandValues[string]>) => {
    const parameter = tool.parameters.find((p) => p.id === parameterId)!
    const next = { ...values, [parameterId]: { ...values[parameterId], ...patch } }
    if (patch.enabled && parameter.exclusiveGroup)
      for (const p of tool.parameters)
        if (p.id !== parameterId && p.exclusiveGroup === parameter.exclusiveGroup)
          next[p.id] = { ...next[p.id], enabled: false }
    if (patch.enabled && (mode === 'simple' || parameter.type !== 'boolean'))
      setFocusTarget(parameterId)
    setDrafts((drafts) => ({ ...drafts, [tool.id]: next }))
  }
  const selectTool = (toolId: string) => {
    setSelected(toolId)
    if (mode === 'simple') setFocusTarget('@tool')
    if (fields.current) fields.current.scrollTop = 0
  }
  const markTouched = (parameterId: string) =>
    setTouched((previous) => new Set([...previous, `${tool.id}:${parameterId}`]))
  const removeParameter = (parameterId: string) => {
    change(parameterId, { enabled: false })
    setFocusTarget('@add')
    setTouched((previous) => {
      const next = new Set(previous)
      next.delete(`${tool.id}:${parameterId}`)
      return next
    })
  }
  const required = tool.parameters.filter((p) => p.required)
  const optional = tool.parameters.filter((p) => !p.required)
  const selectedParameters = [...required, ...optional.filter((p) => values[p.id].enabled)]
  const toggles = selectedParameters.filter((p) => p.type === 'boolean')
  const groups = [...new Set(optional.map((p) => p.group))]
  const tools = config.tools.filter((tool) =>
    [tool.name, tool.description, ...tool.command].some((text) =>
      t(text).toLowerCase().includes(toolQuery.trim().toLowerCase()),
    ),
  )
  const renderParameter = (p: CommandParameter) => {
    const compactToggle = mode === 'simple' && p.type === 'boolean'
    const state = values[p.id]
    const issue = result.issues.find((issue) => issue.id === p.id)
    const showIssue = !!issue && (!!state.value.trim() || touched.has(`${tool.id}:${p.id}`))
    const inputId = `${id}-${p.id}-value`
    const helpId = `${id}-${p.id}-help`
    const descriptionId = `${id}-${p.id}-description`
    return (
      <div
        className={
          (compactToggle ? 'command-toggle' : 'command-parameter') +
          (state.enabled ? ' enabled' : '') +
          (p.required ? ' required' : '') +
          (showIssue ? ' invalid' : '')
        }
        id={`${id}-${p.id}`}
        key={p.id}
        tabIndex={-1}
        role="group"
        aria-label={t(p.label)}
        title={compactToggle && p.description ? t(p.description) : undefined}
      >
        <div className="command-parameter-label">
          {p.required || mode === 'simple' ? (
            <label htmlFor={p.type === 'choice' || p.type === 'boolean' ? undefined : inputId}>
              {p.type === 'boolean' && mode === 'simple' && <Check size={14} />}
              <span>{t(p.label)}</span>
              {p.required && mode === 'advanced' && <small>{t('Required')}</small>}
            </label>
          ) : (
            <label>
              <input
                type="checkbox"
                aria-label={t(p.label)}
                checked={state.enabled}
                onChange={(e) => change(p.id, { enabled: e.target.checked })}
              />
              <span>{t(p.label)}</span>
            </label>
          )}
          {mode === 'advanced' && p.flag && <code>{p.flag}</code>}
          {mode === 'simple' && !compactToggle && p.description && (
            <CommandParameterHelp label={p.label} description={p.description} />
          )}
        </div>
        {mode === 'simple' && !p.required && (
          <button
            className="icon-button command-remove-parameter"
            aria-label={`${t('Remove parameter')}: ${t(p.label)}`}
            title={t('Remove parameter')}
            onClick={() => removeParameter(p.id)}
          >
            <X size={14} />
          </button>
        )}
        {p.description && (
          <p
            id={descriptionId}
            className={mode === 'simple' ? 'command-visually-hidden' : undefined}
          >
            {t(p.description)}
          </p>
        )}
        {state.enabled && p.type !== 'boolean' && (
          <div
            className="command-parameter-value"
            onBlurCapture={(event) => {
              if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node))
                return
              if ((event.target as HTMLElement).matches('input, textarea, .database-picker'))
                markTouched(p.id)
            }}
          >
            <div className="command-value-editor">
              {p.type === 'choice' ? (
                <PopoverPicker
                  label={t(p.label)}
                  value={state.value}
                  options={[
                    { value: '', label: t('Choose a value') },
                    ...p.choices.map((c) => ({ value: c.value, label: t(c.label) })),
                  ]}
                  onChange={(value) => change(p.id, { value })}
                />
              ) : p.repeatable ? (
                <textarea
                  id={inputId}
                  rows={mode === 'simple' ? 1 : 2}
                  wrap={mode === 'simple' ? 'off' : 'soft'}
                  title={mode === 'simple' ? t('One value per line') : undefined}
                  aria-label={t(p.label)}
                  aria-invalid={showIssue}
                  aria-required={p.required}
                  aria-describedby={[p.description ? descriptionId : '', helpId]
                    .filter(Boolean)
                    .join(' ')}
                  placeholder={t(p.placeholder)}
                  value={state.value}
                  maxLength={16000}
                  onChange={(e) => change(p.id, { value: e.target.value })}
                />
              ) : (
                <input
                  id={inputId}
                  type="text"
                  inputMode={p.type === 'number' ? 'decimal' : 'text'}
                  aria-label={t(p.label)}
                  aria-invalid={showIssue}
                  aria-required={p.required}
                  aria-describedby={[p.description ? descriptionId : '', helpId]
                    .filter(Boolean)
                    .join(' ')}
                  placeholder={t(p.placeholder)}
                  value={state.value}
                  maxLength={16000}
                  onChange={(e) => change(p.id, { value: e.target.value })}
                />
              )}
              {p.type === 'text' && p.choices.length > 0 && (
                <CommandValueSuggestions
                  parameter={p}
                  value={state.value}
                  onChoose={(value) => {
                    change(p.id, { value })
                    setFocusTarget(p.id)
                  }}
                />
              )}
            </div>
            <small
              id={helpId}
              className={
                showIssue
                  ? 'command-field-error'
                  : mode === 'simple'
                    ? 'command-visually-hidden'
                    : undefined
              }
            >
              {showIssue ? t(issue!.message) : p.repeatable ? t('One value per line') : '\u00A0'}
            </small>
          </div>
        )}
      </div>
    )
  }
  return (
    <article className={'command-builder command-mode-' + mode}>
      <header className="command-builder-heading">
        <Terminal size={21} />
        <h1>{t('Command builder')}</h1>
        <button className="button" onClick={onSettings}>
          <Settings2 size={14} />
          {t('Configure')}
        </button>
      </header>
      <div className="command-layout">
        {mode === 'advanced' && (
          <aside className="command-tools-rail">
            <div className="plugin-rail-heading">
              <h2>
                {t('Tools')} <small>{config.tools.length}</small>
              </h2>
            </div>
            <div className="plugin-rail-search">
              <Search size={13} />
              <input
                aria-label={t('Find a tool')}
                placeholder={t('Find a tool…')}
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
              />
            </div>
            <nav
              className="command-tool-list"
              aria-label={t('Tool catalog')}
              onKeyDown={navigatePluginList}
            >
              {tools.map((item) => (
                <button
                  key={item.id}
                  aria-current={item.id === tool.id ? 'true' : undefined}
                  title={t(item.description) || item.name}
                  onClick={() => selectTool(item.id)}
                >
                  <Terminal size={13} />
                  <span>{item.name}</span>
                </button>
              ))}
              {!tools.length && <p className="plugin-empty">{t('No matching tools')}</p>}
            </nav>
          </aside>
        )}
        <div className="command-workspace">
          <header className="command-tool-heading">
            {mode === 'advanced' && (
              <div className="command-tool-summary">
                <h2 title={t(tool.description)}>{tool.name}</h2>
                {tool.description && <p>{t(tool.description)}</p>}
              </div>
            )}
            <div className="command-mode-switch" role="group" aria-label={t('Builder mode')}>
              {(['simple', 'advanced'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value)
                    if (fields.current) fields.current.scrollTop = 0
                  }}
                >
                  {t(value === 'simple' ? 'Simple' : 'Advanced')}
                </button>
              ))}
            </div>
            <PluginActionsMenu
              label={t('Command actions')}
              actions={[
                ...(tool.documentation
                  ? [
                      {
                        label: t('Documentation'),
                        icon: <ExternalLink size={14} />,
                        onClick: () => run(() => window.sheco.external(tool.documentation)),
                      },
                    ]
                  : []),
                {
                  label: t('Reset parameters'),
                  icon: <RotateCcw size={14} />,
                  onClick: () => {
                    setDrafts((drafts) => ({ ...drafts, [tool.id]: {} }))
                    setOutputs((previous) =>
                      Object.fromEntries(
                        Object.entries(previous).filter(([key]) => !key.startsWith(tool.id + ':')),
                      ),
                    )
                    setTouched(
                      (previous) =>
                        new Set([...previous].filter((key) => !key.startsWith(tool.id + ':'))),
                    )
                  },
                },
              ]}
            />
          </header>
          <div className="command-fields" ref={fields} key={tool.id}>
            {mode === 'simple' ? (
              <div className="command-block-chain" aria-label={t('Command blocks')}>
                <div className="command-tool-node" title={t(tool.description)}>
                  <PopoverPicker
                    label={t('Tool')}
                    className="command-tool-picker"
                    popoverClassName="command-tool-popover"
                    value={tool.id}
                    options={config.tools.map((item) => ({
                      value: item.id,
                      label: item.name,
                      icon: <Terminal size={16} />,
                    }))}
                    onChange={selectTool}
                  />
                </div>
                {selectedParameters.filter((p) => p.type !== 'boolean').map(renderParameter)}
                {!!toggles.length && (
                  <div
                    className="command-toggle-group"
                    role="group"
                    aria-label={t('Selected parameters')}
                  >
                    {toggles.map(renderParameter)}
                  </div>
                )}
                <CommandParameterMenu
                  key={tool.id}
                  parameters={optional.filter((p) => !values[p.id].enabled)}
                  anchor={addButton}
                  onAdd={(parameterId) => change(parameterId, { enabled: true })}
                />
              </div>
            ) : (
              <>
                {!!required.length && (
                  <section className="command-group command-required">
                    <h3>{t('Required parameters')}</h3>
                    <div className="command-parameter-grid">{required.map(renderParameter)}</div>
                  </section>
                )}
                {groups.map((group) => (
                  <section className="command-group" key={group}>
                    <h3>{t(group)}</h3>
                    <div className="command-parameter-grid">
                      {optional.filter((p) => p.group === group).map(renderParameter)}
                    </div>
                  </section>
                ))}
                {!tool.parameters.length && (
                  <p className="command-empty">{t('No parameters yet')}</p>
                )}
              </>
            )}
          </div>
          <aside className="command-result">
            <div className="command-result-header">
              <div>
                <Terminal size={15} />
                <h2>{t('Ready command')}</h2>
              </div>
              {!!outputPresets.length && (
                <PopoverPicker
                  label={t('Extended output')}
                  className="command-output-picker"
                  value={outputPresetId}
                  options={[
                    { value: '', label: t('Standard output') },
                    ...outputPresets.map((preset) => ({
                      value: preset.id,
                      label: t(preset.label),
                    })),
                  ]}
                  onChange={(value) =>
                    setOutputs((previous) => ({ ...previous, [outputKey]: value }))
                  }
                />
              )}
              <PopoverPicker
                label={t('Shell')}
                value={shell}
                options={[
                  { value: 'posix', label: 'Bash / Zsh' },
                  { value: 'powershell', label: 'PowerShell 7' },
                ]}
                onChange={setShell}
              />
              <button
                className="button primary"
                disabled={!!result.issues.length}
                title={
                  result.issues.length
                    ? result.issues
                        .map((issue) => `${t(issue.label)}: ${t(issue.message)}`)
                        .join('\n')
                    : undefined
                }
                onClick={() =>
                  run(async () => {
                    await window.sheco.copyText(result.command)
                    notify(t('Command copied.'))
                  })
                }
              >
                <Copy size={14} />
                {t('Copy command')}
              </button>
            </div>
            <pre aria-label={t('Ready command')}>
              <code>{result.command}</code>
            </pre>
          </aside>
        </div>
      </div>
    </article>
  )
}
