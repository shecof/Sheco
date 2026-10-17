import { ArrowRight } from 'lucide-react'
import { useI18n } from '../i18n'

// Shared command legend for built-in plugins; display only actions the app supports.
export function PluginCommands({
  enabled,
  commands,
}: {
  enabled: boolean
  commands: { trigger: string; label: string; kind: 'slash' | 'menu' }[]
}) {
  const { t } = useI18n()
  const slashCommands = commands.filter((command) => command.kind === 'slash')
  if (!slashCommands.length) return null
  return (
    <details className={'plugin-commands' + (enabled ? '' : ' inactive')}>
      <summary className="plugin-commands-heading" aria-label={t('Commands')}>
        {t('Commands')}
        <span>{slashCommands.length}</span>
      </summary>
      <ul>
        {slashCommands.map((command) => {
          return (
            <li key={command.trigger}>
              <span className="plugin-command-trigger">
                {command.kind === 'slash' ? (
                  <code>{command.trigger}</code>
                ) : (
                  <span>{t(command.trigger)}</span>
                )}
              </span>
              <ArrowRight size={12} aria-hidden="true" />
              <span>{t(command.label)}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
