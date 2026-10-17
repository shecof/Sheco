import { useEffect, useState } from 'react'
import { Copy, RefreshCw, Plug, Check, ArrowUpRight } from 'lucide-react'
import { useI18n } from '../i18n'
import { PluginSettingsHeader } from './PluginSettingsHeader'
import { useApp } from '../state'
import type { McpConfig, McpStatus } from '../shared/mcp'

export function McpSettings({
  configuration = false,
  onConfigure,
}: {
  configuration?: boolean
  onConfigure?: () => void
}) {
  const { t } = useI18n()
  const { w, data, notify, flush } = useApp()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [port, setPort] = useState('24876')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = () =>
      window.sheco
        .mcpStatus()
        .then((next) => {
          if (alive) setStatus(next)
          return next
        })
        .catch((e) => {
          if (alive) setError(String(e))
          return null
        })
    void refresh().then((next) => {
      if (alive && next) setPort(String(next.config.port))
    })
    window.addEventListener('sheco-mcp-changed', refresh)
    const timer = setInterval(() => {
      void refresh()
    }, 5000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('sheco-mcp-changed', refresh)
    }
  }, [])
  async function configure(patch: Partial<McpConfig>) {
    if (!status || pending) return
    setPending(true)
    setError('')
    try {
      await flush()
      const next = await window.sheco.configureMcp({ ...status.config, ...patch })
      setStatus(next)
      window.dispatchEvent(new Event('sheco-mcp-changed'))
      setPort(String(next.config.port))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }
  async function copy(value: string, label: string) {
    try {
      await window.sheco.copyText(value)
      setCopied(label)
      notify(t('Copied to clipboard.'))
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setError(t('Could not copy. Select and copy the text manually.'))
    }
  }
  const authorized = data?.spaces.find((space) => space.id === status?.config.workspaceId)
  const active = status?.config.workspaceId === w?.id
  return (
    <section
      className={
        'plugin-card mcp-settings ' + (configuration ? 'mcp-configuration' : 'mcp-plugin-card')
      }
      aria-label={t('AI agents · MCP')}
    >
      <PluginSettingsHeader
        icon={Plug}
        title={t('AI agents · MCP')}
        description={t('Local MCP access for agents while Sheco is open.')}
      >
        <button
          type="button"
          className={'setting-switch ' + (status?.config.enabled ? 'on' : '')}
          role="switch"
          aria-label={t('Enable MCP')}
          aria-checked={!!status?.config.enabled}
          disabled={!status || pending}
          onClick={() =>
            void configure({
              enabled: !status!.config.enabled,
              workspaceId: status!.config.workspaceId ?? w!.id,
            })
          }
        >
          <span />
        </button>
      </PluginSettingsHeader>
      {!configuration && (
        <div className="plugin-card-actions">
          <button className="button" onClick={onConfigure}>
            {t('Configure')}
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {status && configuration && (
        <>
          <div className="setting-row">
            <div>
              <strong>{t('Allow changes')}</strong>
              <p>
                {t(
                  'Create and edit pages, every block type, database entries and attachments. Turning this off leaves reading and search available.',
                )}
              </p>
            </div>
            <button
              type="button"
              className={'setting-switch ' + (status.config.allowWrites ? 'on' : '')}
              role="switch"
              aria-label={t('Allow MCP writes')}
              aria-checked={status.config.allowWrites}
              disabled={pending}
              onClick={() => void configure({ allowWrites: !status.config.allowWrites })}
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t('Accessible workspace')}</strong>
              <p>
                {authorized?.name ?? t('Current workspace')}
                {status.config.workspaceId && !active
                  ? ' · ' + t('Open this workspace to allow access')
                  : ''}
              </p>
            </div>
            <button
              type="button"
              className="button"
              disabled={pending || active}
              onClick={() => void configure({ workspaceId: w!.id })}
            >
              {t('Use current workspace')}
            </button>
          </div>
          <div className="mcp-connection">
            <div className="mcp-state" role="status">
              <span className={'mcp-dot ' + (status.running && active ? 'online' : '')} />
              {!status.config.enabled
                ? t('Disabled')
                : status.error
                  ? t('Connection unavailable')
                  : !active
                    ? t('Waiting for workspace')
                    : status.running
                      ? t('Ready for agents')
                      : t('Starting…')}
              <span>{status.config.allowWrites ? t('Read & write') : t('Read only')}</span>
            </div>
            <label className="mcp-field">
              <span>{t('Server address')}</span>
              <div>
                <input readOnly value={status.endpoint} aria-label={t('MCP server address')} />
                <button
                  type="button"
                  className="icon-button"
                  title={t('Copy server address')}
                  onClick={() => void copy(status.endpoint, 'endpoint')}
                >
                  {copied === 'endpoint' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </label>
            <label className="mcp-field">
              <span>{t('Access key')}</span>
              <div>
                <input
                  type="password"
                  readOnly
                  value={status.config.token}
                  aria-label={t('MCP access key')}
                />
                <button
                  type="button"
                  className="icon-button"
                  title={t('Copy access key')}
                  onClick={() => void copy(status.config.token, 'key')}
                >
                  {copied === 'key' ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('Generate a new access key')}
                  disabled={pending}
                  onClick={async () => {
                    setPending(true)
                    try {
                      setStatus(await window.sheco.rotateMcpToken())
                      notify(t('Access key replaced. Reconnect your agents.'))
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setPending(false)
                    }
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </label>
            <form
              className="mcp-port"
              onSubmit={(e) => {
                e.preventDefault()
                void configure({ port: Number(port) })
              }}
            >
              <label>
                {t('Port')}
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  aria-label={t('MCP port')}
                />
              </label>
              <button
                className="button"
                disabled={
                  pending ||
                  Number(port) === status.config.port ||
                  Number(port) < 1024 ||
                  Number(port) > 65535
                }
              >
                {t('Apply')}
              </button>
            </form>
            <p>
              {t(
                'Choose Streamable HTTP in your agent, paste the address, and use the access key as a Bearer token. The connection is available only on this computer.',
              )}
            </p>
            <button
              type="button"
              className="button"
              onClick={() =>
                void copy(
                  JSON.stringify(
                    {
                      mcpServers: {
                        sheco: {
                          url: status.endpoint,
                          headers: { Authorization: `Bearer ${status.config.token}` },
                        },
                      },
                    },
                    null,
                    2,
                  ),
                  'config',
                )
              }
            >
              <Copy size={14} />
              {t('Copy connection settings')}
            </button>
            <details>
              <summary>{t('Available tools')}</summary>
              <p>
                {t(
                  'Search and read pages · Create and edit any block · Move blocks · Trash and restore pages · Manage database columns and entries · Upload and read attachments. Agents also receive a complete block reference with examples.',
                )}
              </p>
            </details>
          </div>
          {status.error && (
            <p className="mcp-error" role="alert">
              {t(status.error)}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="mcp-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
