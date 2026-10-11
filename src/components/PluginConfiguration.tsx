import { useEffect, useRef, useState, useId } from 'react'
import {
  Terminal,
  Download,
  Upload,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Settings2,
  FileJson,
  ArrowLeft,
  ChevronRight,
  Check,
  Search,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import {
  commandBuilderConfigSchema,
  commandParameterSchema,
  parsePluginJson,
  type CommandBuilderConfig,
  type CommandTool,
  type CommandParameter,
} from '../shared/plugins'
import { PopoverPicker } from './PopoverPicker'
import { PluginActionsMenu, navigatePluginList } from './PluginControls'
import { CommandOutputEditor } from './CommandOutputEditor'

function SubcommandsInput({
  tool,
  onChange,
}: {
  tool: CommandTool
  onChange: (parts: string[]) => void
}) {
  const [text, setText] = useState(tool.command.slice(1).join(' '))
  return (
    <input
      value={text}
      placeholder="dir"
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value.split(/\s+/).filter(Boolean))
      }}
    />
  )
}
function ChoicesInput({
  parameter,
  onChange,
}: {
  parameter: CommandParameter
  onChange: (choices: CommandParameter['choices']) => void
}) {
  const [text, setText] = useState(
    parameter.choices.map((c) => `${c.value} | ${c.label}`).join('\n'),
  )
  return (
    <textarea
      rows={4}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(
          e.target.value
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              const index = line.indexOf('|')
              return index < 0
                ? { value: line.trim(), label: line.trim() }
                : { value: line.slice(0, index).trim(), label: line.slice(index + 1).trim() }
            }),
        )
      }}
    />
  )
}

export function PluginConfiguration({ onOpen }: { onOpen: () => void }) {
  const { w, update, notify, run } = useApp()
  const { t } = useI18n()
  const plugin = w!.plugins.commandBuilder
  const [mode, setMode] = useState<'tools' | 'json'>('tools')
  const [draft, setDraft] = useState<CommandBuilderConfig>(plugin.config)
  const [json, setJson] = useState('')
  const [toolId, setToolId] = useState(plugin.config.tools[0].id)
  const [parameterId, setParameterId] = useState('')
  const [toolQuery, setToolQuery] = useState('')
  const [parameterQuery, setParameterQuery] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const version = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const tool = draft.tools.find((tool) => tool.id === toolId) ?? draft.tools[0]
  const parameter = tool.parameters.find((p) => p.id === parameterId)
  const outputEditor = parameterId === '@output'
  const inspectorLabel = outputEditor
    ? 'Output templates'
    : parameter
      ? 'Parameter'
      : 'Tool details'
  const dirty =
    mode === 'json'
      ? json !== JSON.stringify(plugin.config, null, 2)
      : JSON.stringify(draft) !== JSON.stringify(plugin.config)
  const tools = draft.tools.filter((item) =>
    item.name.toLowerCase().includes(toolQuery.toLowerCase()),
  )
  const parameters = tool.parameters.filter((p) =>
    [t(p.label), p.flag, t(p.group)].some((text) =>
      text.toLowerCase().includes(parameterQuery.toLowerCase()),
    ),
  )
  const changed = (next: CommandBuilderConfig) => {
    version.current++
    setError('')
    setDraft(next)
  }
  const editTool = (patch: Partial<CommandTool>) =>
    changed({
      ...draft,
      tools: draft.tools.map((item) => (item.id === tool.id ? { ...item, ...patch } : item)),
    })
  const editParameter = (patch: Partial<CommandParameter>) =>
    editTool({
      parameters: tool.parameters.map((p) => (p.id === parameterId ? { ...p, ...patch } : p)),
    })
  function candidate() {
    try {
      return mode === 'json' ? parsePluginJson(json) : commandBuilderConfigSchema.parse(draft)
    } catch (e) {
      const path =
        e && typeof e === 'object' && 'issues' in e
          ? (e.issues as { path: (string | number)[] }[])[0]?.path.join('.')
          : ''
      setError(
        t('Invalid plugin JSON. Check the version, tools and parameters.') +
          (path ? ` (${path})` : ''),
      )
      return null
    }
  }
  function save() {
    const config = candidate()
    if (!config) return
    changed(config)
    setJson(JSON.stringify(config, null, 2))
    setEditorVersion((value) => value + 1)
    update((w) => ({
      ...w,
      plugins: { ...w.plugins, commandBuilder: { ...w.plugins.commandBuilder, config } },
    }))
    notify(t('Plugin settings saved.'))
  }
  function discard() {
    changed(plugin.config)
    setEditorVersion((value) => value + 1)
    setJson(JSON.stringify(plugin.config, null, 2))
    setParameterId('')
    setParameterQuery('')
  }
  function switchMode(next: 'tools' | 'json') {
    if (next === mode) return
    if (next === 'json') setJson(JSON.stringify(draft, null, 2))
    else {
      const config = candidate()
      if (!config) return
      changed(config)
      setEditorVersion((value) => value + 1)
    }
    setMode(next)
    setError('')
  }
  function moveParameter(direction: number) {
    const list = [...tool.parameters]
    const index = list.findIndex((p) => p.id === parameterId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    editTool({ parameters: list })
  }
  function addTool() {
    const id = crypto.randomUUID()
    changed({
      ...draft,
      tools: [
        ...draft.tools,
        {
          id,
          name: t('New tool'),
          description: '',
          documentation: '',
          command: ['tool'],
          parameters: [],
          outputPresets: [],
        },
      ],
    })
    setToolId(id)
    setParameterId('')
    setToolQuery('')
    setParameterQuery('')
  }
  function addParameter() {
    const id = crypto.randomUUID()
    editTool({
      parameters: [
        ...tool.parameters,
        commandParameterSchema.parse({ id, label: t('New parameter') }),
      ],
    })
    setParameterId(id)
    setParameterQuery('')
  }
  function importJson() {
    run(async () => {
      const stamp = version.current
      setPending(true)
      try {
        const imported = await window.sheco.importPluginSettings()
        if (!mounted.current || !imported) return
        if (stamp !== version.current) {
          notify(t('Settings changed while importing. Import again to replace the draft.'))
          return
        }
        changed(imported)
        setJson(JSON.stringify(imported, null, 2))
        setMode('json')
        setToolId(imported.tools[0].id)
        setParameterId('')
        setToolQuery('')
        setParameterQuery('')
      } finally {
        if (mounted.current) setPending(false)
      }
    })
  }
  function exportJson() {
    const config = candidate()
    if (config)
      run(async () => {
        const file = await window.sheco.exportPluginSettings(config)
        if (file) notify(t('Plugin JSON exported.'))
      })
  }
  return (
    <article className="plugin-configuration">
      <header className="plugin-configuration-heading">
        <div>
          <h1>{t('Tool configuration')}</h1>
          <p>{t('Choose a tool and edit its parameters.')}</p>
        </div>
        <PluginActionsMenu
          label={t('Catalog actions')}
          actions={[
            {
              label: t('Import JSON'),
              icon: <Upload size={15} />,
              disabled: pending,
              onClick: importJson,
            },
            {
              label: t('Export JSON'),
              icon: <Download size={15} />,
              disabled: pending,
              onClick: exportJson,
            },
            {
              label: t(mode === 'json' ? 'Back to tools' : 'Edit JSON'),
              icon: <FileJson size={15} />,
              onClick: () => switchMode(mode === 'json' ? 'tools' : 'json'),
            },
            ...(plugin.enabled
              ? [
                  {
                    label: t('Open command builder'),
                    icon: <Terminal size={15} />,
                    onClick: onOpen,
                  },
                ]
              : []),
          ]}
        />
      </header>
      {mode === 'json' ? (
        <section className="plugin-json-workspace" aria-label={t('Plugin JSON')}>
          <header>
            <button className="plugin-back" onClick={() => switchMode('tools')}>
              <ArrowLeft size={14} />
              {t('Back to tools')}
            </button>
            <span>{t('Catalog JSON')}</span>
          </header>
          <p>
            {t(
              'Edit or paste a plugin configuration. Applying replaces the tool catalog; the enabled state stays unchanged.',
            )}
          </p>
          <textarea
            className="plugin-json"
            aria-label={t('Plugin JSON')}
            spellCheck={false}
            value={json}
            onChange={(e) => {
              version.current++
              setJson(e.target.value)
              setError('')
            }}
          />
        </section>
      ) : (
        <div className="plugin-catalog-workspace">
          <aside className="plugin-tools-rail" aria-label={t('Tools')}>
            <div className="plugin-rail-heading">
              <h2>
                {t('Tools')}
                <small>{draft.tools.length}</small>
              </h2>
              <button
                className="icon-button"
                title={t('Add tool')}
                aria-label={t('Add tool')}
                disabled={draft.tools.length >= 100}
                onClick={addTool}
              >
                <Plus size={16} />
              </button>
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
              className="plugin-tool-list"
              aria-label={t('Tool catalog')}
              onKeyDown={navigatePluginList}
            >
              {tools.map((item) => (
                <button
                  key={item.id}
                  aria-current={item.id === tool.id ? 'true' : undefined}
                  onClick={() => {
                    setToolId(item.id)
                    setParameterId('')
                    setParameterQuery('')
                  }}
                >
                  <span>{item.name || t('Untitled')}</span>
                  <small>{item.parameters.length}</small>
                </button>
              ))}
              {!tools.length && <p className="plugin-list-empty">{t('No matching tools')}</p>}
            </nav>
          </aside>
          <section className="plugin-tool-workspace" aria-label={tool.name}>
            <nav className="plugin-parameter-rail" aria-label={t('Tool sections')}>
              <div className="plugin-outline-title">
                <strong>{tool.name || t('Untitled')}</strong>
              </div>
              <button
                className="plugin-overview-row"
                aria-current={!parameter && !outputEditor ? 'true' : undefined}
                onClick={() => setParameterId('')}
              >
                <Settings2 size={14} />
                {t('Tool details')}
              </button>
              <button
                className="plugin-overview-row"
                aria-current={outputEditor ? 'true' : undefined}
                onClick={() => setParameterId('@output')}
              >
                <Terminal size={14} />
                {t('Output templates')}
              </button>
              <div className="plugin-rail-heading">
                <h2>
                  {t('Parameters')}
                  <small>{tool.parameters.length}</small>
                </h2>
                <button
                  className="icon-button"
                  title={t('Add parameter')}
                  aria-label={t('Add parameter')}
                  disabled={tool.parameters.length >= 100}
                  onClick={addParameter}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="plugin-rail-search">
                <Search size={13} />
                <input
                  aria-label={t('Find a parameter')}
                  placeholder={t('Find a parameter…')}
                  value={parameterQuery}
                  onChange={(e) => setParameterQuery(e.target.value)}
                />
              </div>
              <div className="plugin-parameter-list" onKeyDown={navigatePluginList}>
                {parameters.map((p) => (
                  <button
                    key={p.id}
                    aria-current={p.id === parameter?.id ? 'true' : undefined}
                    onClick={() => setParameterId(p.id)}
                  >
                    <span>{t(p.label) || t('Untitled')}</span>
                    <code>
                      {p.flag ||
                        t(
                          p.position === 'argument'
                            ? 'Positional argument'
                            : {
                                boolean: 'Switch',
                                text: 'Text',
                                number: 'Number',
                                choice: 'Choice',
                              }[p.type],
                        )}
                    </code>
                  </button>
                ))}
                {!parameters.length && (
                  <p className="plugin-list-empty">
                    {t(tool.parameters.length ? 'No matching parameters' : 'No parameters yet')}
                  </p>
                )}
              </div>
            </nav>
            <section className="plugin-inspector" aria-label={t(inspectorLabel)}>
              <header className="plugin-inspector-heading">
                <div>
                  <span>{t(inspectorLabel)}</span>
                  <h2>
                    {parameter ? t(parameter.label) || t('Untitled') : tool.name || t('Untitled')}
                  </h2>
                </div>
                {parameter ? (
                  <PluginActionsMenu
                    label={t('Parameter actions')}
                    actions={[
                      {
                        label: t('Move parameter up'),
                        icon: <ArrowUp size={15} />,
                        disabled: tool.parameters[0].id === parameter.id,
                        onClick: () => moveParameter(-1),
                      },
                      {
                        label: t('Move parameter down'),
                        icon: <ArrowDown size={15} />,
                        disabled: tool.parameters.at(-1)!.id === parameter.id,
                        onClick: () => moveParameter(1),
                      },
                      {
                        label: t('Remove parameter'),
                        icon: <Trash2 size={15} />,
                        danger: true,
                        onClick: () => {
                          editTool({
                            parameters: tool.parameters.filter((p) => p.id !== parameter.id),
                          })
                          setParameterId('')
                        },
                      },
                    ]}
                  />
                ) : (
                  <PluginActionsMenu
                    label={t('Tool actions')}
                    actions={[
                      {
                        label: t('Remove tool'),
                        icon: <Trash2 size={15} />,
                        danger: true,
                        disabled: draft.tools.length <= 1,
                        onClick: () => {
                          changed({
                            ...draft,
                            tools: draft.tools.filter((item) => item.id !== tool.id),
                          })
                          setParameterId('')
                          setParameterQuery('')
                        },
                      },
                    ]}
                  />
                )}
              </header>
              <div
                className="plugin-inspector-content"
                key={tool.id + ':' + parameterId + ':' + editorVersion}
              >
                {outputEditor ? (
                  <CommandOutputEditor
                    presets={tool.outputPresets}
                    onChange={(outputPresets) => editTool({ outputPresets })}
                  />
                ) : !parameter ? (
                  <>
                    <div className="plugin-form-grid">
                      <label>
                        {t('Tool name')}
                        <input
                          value={tool.name}
                          maxLength={100}
                          onChange={(e) => editTool({ name: e.target.value })}
                        />
                      </label>
                      <label>
                        {t('Executable')}
                        <input
                          value={tool.command[0]}
                          maxLength={500}
                          onChange={(e) =>
                            editTool({ command: [e.target.value, ...tool.command.slice(1)] })
                          }
                        />
                      </label>
                      <label className="full">
                        {t('Description')}
                        <textarea
                          rows={3}
                          value={tool.description}
                          maxLength={1000}
                          onChange={(e) => editTool({ description: e.target.value })}
                        />
                      </label>
                    </div>
                    <details className="plugin-advanced">
                      <summary>
                        <ChevronRight size={14} />
                        {t('Additional settings')}
                      </summary>
                      <div className="plugin-form-grid">
                        <label className="full">
                          {t('Subcommands')}
                          <SubcommandsInput
                            tool={tool}
                            onChange={(parts) => editTool({ command: [tool.command[0], ...parts] })}
                          />
                        </label>
                        <label className="full">
                          {t('Documentation URL')}
                          <input
                            value={tool.documentation}
                            maxLength={1000}
                            onChange={(e) => editTool({ documentation: e.target.value })}
                          />
                        </label>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="plugin-form-grid">
                      <label className="full">
                        {t('Parameter label')}
                        <input
                          value={parameter.label}
                          maxLength={100}
                          onChange={(e) => editParameter({ label: e.target.value })}
                        />
                      </label>
                      <label>
                        {t('Flag')}
                        <input
                          value={parameter.flag}
                          placeholder="--output"
                          maxLength={80}
                          disabled={parameter.position === 'argument'}
                          onChange={(e) => editParameter({ flag: e.target.value })}
                        />
                      </label>
                      <div>
                        <span className="field-label">{t('Value type')}</span>
                        <PopoverPicker
                          popoverClassName="plugin-picker-popover"
                          label={t('Value type')}
                          value={parameter.type}
                          options={(['boolean', 'text', 'number', 'choice'] as const).map(
                            (value) => ({
                              value,
                              label: t(
                                {
                                  boolean: 'Switch',
                                  text: 'Text',
                                  number: 'Number',
                                  choice: 'Choice',
                                }[value],
                              ),
                            }),
                          )}
                          onChange={(type) =>
                            editParameter({
                              type,
                              repeatable: type === 'boolean' ? false : parameter.repeatable,
                              ...(type === 'boolean' ? { position: 'option' } : {}),
                            })
                          }
                        />
                      </div>
                      {parameter.type === 'choice' && (
                        <label className="full">
                          {t('Choices: value | label, one per line')}
                          <ChoicesInput
                            parameter={parameter}
                            onChange={(choices) => editParameter({ choices })}
                          />
                        </label>
                      )}
                      <label className="full">
                        {t('Description')}
                        <textarea
                          rows={2}
                          value={parameter.description}
                          maxLength={1000}
                          onChange={(e) => editParameter({ description: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="plugin-checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={parameter.required}
                          onChange={(e) => editParameter({ required: e.target.checked })}
                        />
                        {t('Required')}
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          disabled={parameter.type === 'boolean'}
                          checked={parameter.repeatable}
                          onChange={(e) => editParameter({ repeatable: e.target.checked })}
                        />
                        {t('Repeat for each line')}
                      </label>
                    </div>
                    <details className="plugin-advanced">
                      <summary>
                        <ChevronRight size={14} />
                        {t('Additional settings')}
                      </summary>
                      <div className="plugin-form-grid">
                        {parameter.type === 'text' && (
                          <label className="full">
                            {t('Suggestions: value | label, one per line')}
                            <ChoicesInput
                              parameter={parameter}
                              onChange={(choices) => editParameter({ choices })}
                            />
                          </label>
                        )}
                        <label>
                          {t('Parameter group')}
                          <input
                            value={parameter.group}
                            maxLength={100}
                            onChange={(e) => editParameter({ group: e.target.value })}
                          />
                        </label>
                        <label>
                          {t('Placeholder')}
                          <input
                            value={parameter.placeholder}
                            maxLength={300}
                            onChange={(e) => editParameter({ placeholder: e.target.value })}
                          />
                        </label>
                        <div className="full">
                          <span className="field-label">{t('Argument position')}</span>
                          <PopoverPicker
                            popoverClassName="plugin-picker-popover"
                            label={t('Argument position')}
                            value={parameter.position}
                            options={[
                              { value: 'option', label: t('Before positional arguments') },
                              { value: 'argument', label: t('Positional argument') },
                            ]}
                            onChange={(position) =>
                              editParameter({
                                position,
                                ...(position === 'argument'
                                  ? { flag: '', separator: 'space' }
                                  : {}),
                              })
                            }
                          />
                        </div>
                        {parameter.flag && parameter.type !== 'boolean' && (
                          <div className="full">
                            <span className="field-label">{t('Value separator')}</span>
                            <PopoverPicker
                              popoverClassName="plugin-picker-popover"
                              label={t('Value separator')}
                              value={parameter.separator}
                              options={[
                                { value: 'space', label: t('Space') },
                                { value: 'equals', label: '= (--flag=value)' },
                                { value: 'joined', label: t('Joined (-T4)') },
                              ]}
                              onChange={(separator) => editParameter({ separator })}
                            />
                          </div>
                        )}
                        <label className="full">
                          {t('Mutually exclusive group')}
                          <input
                            value={parameter.exclusiveGroup}
                            maxLength={80}
                            onChange={(e) => editParameter({ exclusiveGroup: e.target.value })}
                          />
                        </label>
                      </div>
                    </details>
                  </>
                )}
              </div>
            </section>
          </section>
        </div>
      )}
      <footer className="plugin-configuration-footer">
        <div className="plugin-draft-status" role="status">
          {error ? (
            <p className="plugin-error" role="alert">
              {error}
            </p>
          ) : (
            <>
              {dirty ? <span className="plugin-draft-dot" /> : <Check size={13} />}
              <span>{t(dirty ? 'Unapplied changes' : 'Catalog saved')}</span>
            </>
          )}
        </div>
        {dirty && (
          <button className="plugin-discard" onClick={discard}>
            {t('Discard draft')}
          </button>
        )}
        <button
          className="button primary"
          aria-label={t('Apply plugin settings')}
          disabled={!dirty}
          onClick={save}
        >
          {t('Apply changes')}
        </button>
      </footer>
    </article>
  )
}
