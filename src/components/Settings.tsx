import { useI18n } from '../i18n'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  FolderOpen,
  Download,
  Archive,
  HardDrive,
  LockKeyhole,
  Check,
  Moon,
  Sun,
  Laptop,
  FileWarning,
  Settings2,
  Plug,
  Info,
  Puzzle,
} from 'lucide-react'
import { useApp } from '../state'
import { Modal } from './ui'
import { Logo } from './Logo'
import { McpSettings } from './McpSettings'
import { ReadingSettings } from './ReadingSettings'
import { PluginSettings } from './PluginSettings'

const categories = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'workspace', label: 'Workspace', icon: FolderOpen },
  { id: 'data', label: 'Data & backups', icon: Archive },
  { id: 'agents', label: 'AI agents · MCP', icon: Plug },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'about', label: 'About Sheco', icon: Info },
] as const
type Category = (typeof categories)[number]['id']

export function SettingsDialog({
  onClose,
  initialCategory,
  onOpenPlugin,
  onConfigurePlugin,
}: {
  onClose: () => void
  initialCategory?: Category
  onOpenPlugin: () => void
  onConfigurePlugin: () => void
}) {
  const { t, language, setLanguage } = useI18n()

  const { w, data, update, flush, run, notify, error, importPage } = useApp()
  const [name, setName] = useState(w!.name)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState<Category>(
    initialCategory ?? (error ? 'data' : 'general'),
  )
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  function navigate(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (e.key === 'ArrowDown') next = (index + 1) % categories.length
    else if (e.key === 'ArrowUp') next = (index + categories.length - 1) % categories.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = categories.length - 1
    else return
    e.preventDefault()
    setCategory(categories[next].id)
    tabs.current[next]?.focus()
  }
  const panel = (key: Category) => ({
    className: 'settings-panel',
    role: 'tabpanel',
    id: `${id}-panel-${key}`,
    'aria-labelledby': `${id}-tab-${key}`,
    hidden: category !== key,
    tabIndex: 0,
  })
  return (
    <Modal title={t('Settings')} className="settings-dialog" onClose={onClose}>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div role="tablist" aria-label={t('Settings categories')} aria-orientation="vertical">
            {categories.map((item, index) => (
              <button
                key={item.id}
                ref={(node) => {
                  tabs.current[index] = node
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${item.id}`}
                aria-controls={`${id}-panel-${item.id}`}
                aria-selected={category === item.id}
                tabIndex={category === item.id ? 0 : -1}
                data-autofocus={category === item.id ? '' : undefined}
                onClick={() => setCategory(item.id)}
                onKeyDown={(e) => navigate(e, index)}
              >
                <item.icon size={16} aria-hidden="true" />
                <span>{t(item.label)}</span>
                {item.id === 'data' && error && (
                  <FileWarning
                    size={14}
                    className="settings-warning"
                    aria-label={t('Save your unsaved edits')}
                  />
                )}
              </button>
            ))}
          </div>
        </aside>
        <div className="settings-panels">
          <div {...panel('general')}>
            <section>
              <h3>{t('General')}</h3>
              <div className="setting-row">
                <div>
                  <strong>{t('Appearance')}</strong>
                  <p>{t('Choose what feels right.')}</p>
                </div>
                <div className="theme-options" role="group" aria-label={t('Appearance')}>
                  {[
                    { id: 'light', name: 'Light', icon: Sun },
                    { id: 'dark', name: 'Dark', icon: Moon },
                    { id: 'system', name: 'System', icon: Laptop },
                  ].map((item) => (
                    <button
                      type="button"
                      className={w!.ui.theme === item.id ? 'active' : ''}
                      aria-pressed={w!.ui.theme === item.id}
                      key={item.id}
                      title={t(item.name)}
                      onClick={() =>
                        update((w) => ({
                          ...w,
                          ui: { ...w.ui, theme: item.id as 'light' | 'dark' | 'system' },
                        }))
                      }
                    >
                      <item.icon size={15} />
                      {t(item.name)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row accent-setting">
                <div>
                  <strong>{t('Accent color')}</strong>
                  <p>{t('Color for buttons, links, and selected items.')}</p>
                </div>
                <div className="accent-options" role="group" aria-label={t('Accent color')}>
                  {(
                    [
                      ['neutral', 'Neutral'],
                      ['blue', 'Blue'],
                      ['green', 'Green'],
                      ['purple', 'Purple'],
                      ['orange', 'Orange'],
                    ] as const
                  ).map(([accent, label]) => (
                    <button
                      key={accent}
                      type="button"
                      data-accent={accent}
                      aria-label={t(label)}
                      title={t(label)}
                      aria-pressed={w!.ui.accent === accent}
                      onClick={() => update((w) => ({ ...w, ui: { ...w.ui, accent } }))}
                    >
                      {w!.ui.accent === accent && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t('Language')}</strong>
                  <p>{t('Choose your interface language.')}</p>
                </div>
                <div className="theme-options" role="group" aria-label={t('Interface language')}>
                  <button
                    type="button"
                    className={language === 'en' ? 'active' : ''}
                    aria-pressed={language === 'en'}
                    onClick={() => setLanguage('en')}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    className={language === 'ru' ? 'active' : ''}
                    aria-pressed={language === 'ru'}
                    onClick={() => setLanguage('ru')}
                  >
                    Русский
                  </button>
                </div>
              </div>
            </section>
            <section>
              <h3>{t('Reading')}</h3>
              <ReadingSettings />
            </section>
          </div>
          <div {...panel('workspace')}>
            <section>
              <h3>{t('Workspace')}</h3>
              <div className="setting-row">
                <div>
                  <strong>{t('Name')}</strong>
                  <p>{t('A separate home for this collection.')}</p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    update((w) => ({ ...w, name: name.trim() }))
                    run(async () => {
                      await flush()
                      notify(t('Workspace renamed.'))
                    })
                  }}
                >
                  <input
                    aria-label={t('Workspace name')}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    className="icon-button"
                    title={t('Save workspace name')}
                    disabled={!name.trim()}
                  >
                    <Check size={16} />
                  </button>
                </form>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t('Workspace folder')}</strong>
                  <p className="folder-path">{data!.path}</p>
                </div>
                <button className="button" onClick={() => run(() => window.sheco.showFolder())}>
                  <FolderOpen size={15} />
                  {t('Open folder')}
                </button>
              </div>
            </section>
          </div>
          <div {...panel('agents')}>
            <McpSettings />
          </div>
          <div {...panel('plugins')}>
            <PluginSettings onOpen={onOpenPlugin} onConfigure={onConfigurePlugin} />
          </div>
          <div {...panel('data')}>
            <section>
              <h3>{t('Data & backups')}</h3>
              <div className="setting-row">
                <div>
                  <strong>{t('Export workspace')}</strong>
                  <p>
                    {t(
                      'Markdown pages, CSV databases, attachments, and a complete Sheco snapshot.',
                    )}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={saving}
                  onClick={() =>
                    run(async () => {
                      setSaving(true)
                      try {
                        await flush()
                        const result = await window.sheco.exportWorkspace()
                        if (result) notify(t('Workspace exported to ') + result)
                      } finally {
                        setSaving(false)
                      }
                    })
                  }
                >
                  <Download size={15} />
                  {t('Export')}
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t('Create a backup')}</strong>
                  <p>
                    {t(
                      'A portable snapshot with all attachments. The last 30 save checkpoints are also kept automatically.',
                    )}
                  </p>
                </div>
                <button
                  className="button"
                  onClick={() =>
                    run(async () => {
                      await flush()
                      const file = await window.sheco.backup()
                      notify(t('Backup created at ') + file)
                    })
                  }
                >
                  <Archive size={15} />
                  {t('Back up')}
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>{t('Import a Markdown page')}</strong>
                  <p>
                    {t('Local images inside the document’s folder are copied into your workspace.')}
                  </p>
                </div>
                <button
                  className="button"
                  onClick={() =>
                    run(async () => {
                      await importPage()
                      onClose()
                    })
                  }
                >
                  {t('Import…')}
                </button>
              </div>
              {error && (
                <div className="recovery-setting">
                  <FileWarning size={19} />
                  <div>
                    <strong>{t('Save your unsaved edits')}</strong>
                    <p>{error}</p>
                    <button
                      className="button"
                      onClick={() =>
                        run(async () => {
                          const result = await window.sheco.recovery(w!)
                          if (result) notify(t('Recovery file saved at ') + result)
                        })
                      }
                    >
                      {t('Export unsaved recovery file')}
                    </button>
                    <button className="button" onClick={() => run(flush)}>
                      {t('Retry saving')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
          <div {...panel('about')}>
            <section>
              <h3>{t('About Sheco')}</h3>
              <div className="privacy-note">
                <LockKeyhole size={20} />
                <p>
                  {t(
                    'No account. No telemetry. No automatic uploads. Sheco blocks network requests from the editor. Web links open in your browser only when you click them.',
                  )}
                </p>
              </div>
              <p className="muted small">
                {t(
                  'If you place the workspace in a synced folder, use it on one device at a time. Your sync provider manages transfers; Sheco detects external changes and stops before overwriting them.',
                )}
              </p>
            </section>
            <div className="settings-version">
              <Logo />
              <div>
                <strong>Sheco</strong>
                <span>{t('Version 1.0.0')}</span>
              </div>
              <span>
                <HardDrive size={13} />
                {t('Local by design')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
