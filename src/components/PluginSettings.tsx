import { Terminal, ArrowUpRight } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { commandBuilderTab } from '../shared/plugins'

export function PluginSettings({
  onOpen,
  onConfigure,
}: {
  onOpen: () => void
  onConfigure: () => void
}) {
  const { w, update } = useApp()
  const { t } = useI18n()
  const plugin = w!.plugins.commandBuilder
  return (
    <section className="plugin-settings">
      <h3>{t('Plugins')}</h3>
      <p className="muted small">
        {t('Enable plugins for this workspace. Enabled plugins appear in the sidebar menu.')}
      </p>
      <div className="plugin-card">
        <div className="plugin-card-title">
          <span className="plugin-mark">
            <Terminal size={22} />
          </span>
          <div>
            <strong>{t('Command builder')}</strong>
            <p>{t('A configurable toolkit for pentesters. Nine tools to start with.')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={t('Enable command builder')}
            aria-checked={plugin.enabled}
            className={'setting-switch ' + (plugin.enabled ? 'on' : '')}
            onClick={() =>
              update((w) => {
                const enabled = !w.plugins.commandBuilder.enabled
                const tabs = enabled
                  ? w.ui.tabs
                  : w.ui.tabs.filter((id) => id !== commandBuilderTab)
                return {
                  ...w,
                  plugins: {
                    ...w.plugins,
                    commandBuilder: { ...w.plugins.commandBuilder, enabled },
                  },
                  ui: {
                    ...w.ui,
                    tabs,
                    activeId:
                      w.ui.activeId === commandBuilderTab && !enabled
                        ? (tabs.at(-1) ?? null)
                        : w.ui.activeId,
                  },
                }
              })
            }
          >
            <span />
          </button>
        </div>
        <div className="plugin-card-actions">
          <span className="muted small">{plugin.enabled ? t('Enabled') : t('Disabled')}</span>
          <button className="button" onClick={onConfigure}>
            {t('Configure')}
            <ArrowUpRight size={14} />
          </button>
          {plugin.enabled && (
            <button className="button" onClick={onOpen}>
              {t('Open command builder')}
            </button>
          )}
        </div>
      </div>
      <p className="muted small plugin-settings-note">
        {t('Tool configuration opens in a separate tab.')}
      </p>
    </section>
  )
}
