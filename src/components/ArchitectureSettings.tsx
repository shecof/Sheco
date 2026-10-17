import { Network } from 'lucide-react'
import { useApp } from '../state'
import { useI18n } from '../i18n'
import { projectArchitectureTab } from '../shared/plugins'
import { PluginSettingsHeader } from './PluginSettingsHeader'

export function ArchitectureSettings() {
  const { w, update } = useApp()
  const { t } = useI18n()
  const enabled = w!.plugins.projectArchitecture.enabled
  const defaults = w!.plugins.projectArchitecture.defaults ?? {
    showTitle: true,
    showResources: true,
    showBalances: true,
  }
  return (
    <section className="plugin-settings-page" aria-label={t('Architecture settings')}>
      <h1>{t('Architecture settings')}</h1>
      <div className="plugin-card">
        <PluginSettingsHeader
          icon={Network}
          title={t('Defaults for new diagrams')}
          description={t('These settings apply to new diagrams.')}
        >
          <button
            type="button"
            role="switch"
            aria-label={t('Enable project architecture')}
            aria-checked={enabled}
            className={'setting-switch ' + (enabled ? 'on' : '')}
            onClick={() =>
              update((current) => {
                const enabled = !current.plugins.projectArchitecture.enabled
                const tabs = enabled
                  ? current.ui.tabs
                  : current.ui.tabs.filter((id) => id !== projectArchitectureTab)
                return {
                  ...current,
                  plugins: {
                    ...current.plugins,
                    projectArchitecture: { ...current.plugins.projectArchitecture, enabled },
                  },
                  ui: {
                    ...current.ui,
                    tabs,
                    activeId:
                      !enabled && current.ui.activeId === projectArchitectureTab
                        ? (tabs.at(-1) ?? null)
                        : current.ui.activeId,
                  },
                }
              })
            }
          >
            <span />
          </button>
        </PluginSettingsHeader>
        {(['showTitle', 'showResources', 'showBalances'] as const).map((key) => (
          <div className="setting-row" key={key}>
            <strong>
              {t(
                {
                  showTitle: 'Show project title',
                  showResources: 'Show object resources',
                  showBalances: 'Show resource balance',
                }[key],
              )}
            </strong>
            <button
              type="button"
              role="switch"
              aria-label={t(
                {
                  showTitle: 'Show project title',
                  showResources: 'Show object resources',
                  showBalances: 'Show resource balance',
                }[key],
              )}
              aria-checked={defaults[key]}
              className={'setting-switch ' + (defaults[key] ? 'on' : '')}
              onClick={() => {
                const checked = !defaults[key]
                update((current) => ({
                  ...current,
                  plugins: {
                    ...current.plugins,
                    projectArchitecture: {
                      ...current.plugins.projectArchitecture,
                      defaults: {
                        ...(current.plugins.projectArchitecture.defaults ?? defaults),
                        [key]: checked,
                      },
                    },
                  },
                }))
              }}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
