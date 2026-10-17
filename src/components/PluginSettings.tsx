import { useState } from 'react'
import { Terminal, ArrowUpRight, Braces, FilePlus2, Network } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import {
  commandBuilderTab,
  jiraSettingsTab,
  mcpSettingsTab,
  filePreviewSettingsTab,
  documentTemplatesTab,
  documentTemplatesAvailable,
  documentTemplatesSettingsTab,
  dataToolsTab,
  dataToolsSettingsTab,
  projectArchitectureTab,
  projectArchitectureSettingsTab,
} from '../shared/plugins'
import { JiraPluginSettings } from './JiraPluginSettings'
import { PluginCommands } from './PluginCommands'
import { McpSettings } from './McpSettings'
import { FilePreviewSettings } from './FilePreviewSettings'
import { PluginSettingsHeader } from './PluginSettingsHeader'

export function PluginSettings({
  onOpen,
  onConfigure,
}: {
  onOpen: (id?: string) => void
  onConfigure: (id?: string) => void
}) {
  const { w, update } = useApp()
  const { t } = useI18n()
  const [category, setCategory] = useState('All plugins')
  const plugin = w!.plugins.commandBuilder
  const newPlugins = [
    {
      key: 'documentTemplates' as const,
      title: 'Document templates',
      description: 'Create documents from reusable templates and save your own pages.',
      enable: 'Enable document templates',
      tab: documentTemplatesTab,
      settings: documentTemplatesSettingsTab,
      icon: FilePlus2,
      command: '/templates',
      open: 'Open templates',
    },
    {
      key: 'dataTools' as const,
      title: 'Data tools',
      description: 'Format data, convert encodings, calculate hashes and process text.',
      enable: 'Enable data tools',
      tab: dataToolsTab,
      settings: dataToolsSettingsTab,
      icon: Braces,
      command: '/data',
      open: 'Open data tools',
    },
    {
      key: 'projectArchitecture' as const,
      title: 'Project architecture',
      description: 'Plan sites, servers, databases and websites with a shared resource budget.',
      enable: 'Enable project architecture',
      tab: projectArchitectureTab,
      settings: projectArchitectureSettingsTab,
      icon: Network,
      command: '/architecture',
      open: 'Create architecture diagram',
    },
  ]
  function newPluginCard(definition: (typeof newPlugins)[number]) {
    const enabled = w!.plugins[definition.key].enabled
    return (
      <div className="plugin-card" key={definition.key}>
        <PluginSettingsHeader
          icon={definition.icon}
          title={t(definition.title)}
          description={t(definition.description)}
        >
          <button
            type="button"
            role="switch"
            aria-label={t(definition.enable)}
            aria-checked={enabled}
            className={'setting-switch ' + (enabled ? 'on' : '')}
            onClick={() =>
              update((w) => {
                const enabled = !w.plugins[definition.key].enabled
                const tabs = enabled ? w.ui.tabs : w.ui.tabs.filter((id) => id !== definition.tab)
                const plugins =
                  definition.key === 'documentTemplates'
                    ? {
                        ...w.plugins,
                        documentTemplates: {
                          ...w.plugins.documentTemplates,
                          enabled,
                          initialized: true,
                        },
                      }
                    : definition.key === 'projectArchitecture'
                      ? {
                          ...w.plugins,
                          projectArchitecture: { ...w.plugins.projectArchitecture, enabled },
                        }
                      : { ...w.plugins, dataTools: { ...w.plugins.dataTools, enabled } }
                return {
                  ...w,
                  plugins,
                  ui: {
                    ...w.ui,
                    tabs,
                    activeId:
                      !enabled && w.ui.activeId === definition.tab
                        ? (tabs.at(-1) ?? null)
                        : w.ui.activeId,
                  },
                }
              })
            }
          >
            <span />
          </button>
        </PluginSettingsHeader>
        <div className="plugin-card-actions">
          {definition.settings && (
            <button className="button" onClick={() => onConfigure(definition.settings)}>
              {t('Configure')}
              <ArrowUpRight size={14} />
            </button>
          )}
          {enabled && definition.key !== 'projectArchitecture' && (
            <button className="button" onClick={() => onOpen(definition.tab)}>
              {t(definition.open)}
            </button>
          )}
        </div>
        <PluginCommands
          enabled={enabled}
          commands={[
            ...(definition.command
              ? [{ trigger: definition.command, label: definition.open, kind: 'slash' as const }]
              : []),
            ...(definition.key === 'documentTemplates'
              ? [{ trigger: '/template', label: 'Insert template', kind: 'slash' as const }]
              : []),
          ]}
        />
      </div>
    )
  }
  return (
    <section className="plugin-settings">
      <h3>{t('Plugins')}</h3>
      <div className="plugin-category-pills" aria-label={t('Plugin categories')}>
        {['All plugins', 'Documents', 'Tools', 'Integrations'].map((name) => (
          <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>
            {t(name)}
          </button>
        ))}
      </div>
      <section
        className="plugin-category"
        aria-label={t('Documents')}
        hidden={!['All plugins', 'Documents'].includes(category)}
      >
        <h4>{t('Documents')}</h4>
        {documentTemplatesAvailable && newPluginCard(newPlugins[0])}
        <FilePreviewSettings onConfigure={() => onConfigure(filePreviewSettingsTab)} />
      </section>
      <section
        className="plugin-category"
        aria-label={t('Tools')}
        hidden={!['All plugins', 'Tools'].includes(category)}
      >
        <h4>{t('Tools')}</h4>
        {newPluginCard(newPlugins[1])}
        {newPluginCard(newPlugins[2])}
        <div className="plugin-card">
          <PluginSettingsHeader
            icon={Terminal}
            title={t('Command builder')}
            description={t('A configurable toolkit for pentesters. Nine tools to start with.')}
          >
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
          </PluginSettingsHeader>
          <div className="plugin-card-actions">
            <button className="button" onClick={() => onConfigure()}>
              {t('Configure')}
              <ArrowUpRight size={14} />
            </button>
            {plugin.enabled && (
              <button className="button" onClick={() => onOpen()}>
                {t('Open command builder')}
              </button>
            )}
          </div>
          <PluginCommands
            enabled={plugin.enabled}
            commands={[{ trigger: '/commands', label: 'Open command builder', kind: 'slash' }]}
          />
        </div>
      </section>
      <section
        className="plugin-category"
        aria-label={t('Integrations')}
        hidden={!['All plugins', 'Integrations'].includes(category)}
      >
        <h4>{t('Integrations')}</h4>
        <JiraPluginSettings key={w!.id} onConfigure={() => onConfigure(jiraSettingsTab)} />
        <McpSettings onConfigure={() => onConfigure(mcpSettingsTab)} />
      </section>
    </section>
  )
}
