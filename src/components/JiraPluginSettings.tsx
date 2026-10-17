import { useEffect, useRef, useState } from 'react'
import { Ticket, LockKeyhole, ArrowUpRight, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../state'
import { useI18n } from '../i18n'
import {
  jiraBaseUrlSchema,
  jiraPatSchema,
  jiraEmailSchema,
  normalizeJiraBaseUrl,
  jiraErrorMessage,
  jiraConnectionUrlSchema,
  jiraConnectionSchema,
  jiraConnectionLimit,
  type JiraConnection,
  type JiraAuthType,
} from '../shared/jira'
import { PopoverPicker } from './PopoverPicker'
import { PluginCommands } from './PluginCommands'
import { PluginSettingsHeader } from './PluginSettingsHeader'

export function JiraPluginSettings({
  configuration = false,
  onConfigure,
}: {
  configuration?: boolean
  onConfigure?: () => void
}) {
  const { w, update, flush } = useApp()
  const { t } = useI18n()
  const plugin = w!.plugins.jira
  const [drafts, setDrafts] = useState<JiraConnection[]>(() =>
    plugin.connections.length ? [] : [newConnection()],
  )
  const [selected, setSelected] = useState(plugin.connections[0]?.id ?? drafts[0]?.id ?? '')
  const current = useRef(w)
  current.current = w
  const connections = [
    ...plugin.connections,
    ...drafts.filter((draft) => !plugin.connections.some((item) => item.id === draft.id)),
  ]
  const active = connections.some((item) => item.id === selected) ? selected : connections[0]?.id
  async function remove(connection: JiraConnection) {
    const workspaceId = w!.id
    const saved = plugin.connections.find((item) => item.id === connection.id)
    if (saved) {
      // Keep the form present to report any device-credential failure.
      await window.sheco.forgetJiraToken(workspaceId, saved.baseUrl)
      update((workspace) => {
        if (
          workspace.id !== workspaceId ||
          JSON.stringify(
            workspace.plugins.jira.connections.find((item) => item.id === saved.id),
          ) !== JSON.stringify(saved)
        )
          throw new Error('The Jira configuration changed. Try again.')
        return {
          ...workspace,
          plugins: {
            ...workspace.plugins,
            jira: {
              ...workspace.plugins.jira,
              connections: workspace.plugins.jira.connections.filter(
                (item) => item.id !== saved.id,
              ),
            },
          },
        }
      })
      await flush()
      if (current.current?.id !== workspaceId) return
    }
    setDrafts((items) => items.filter((item) => item.id !== connection.id))
  }
  return (
    <div className="plugin-card jira-plugin-settings">
      <PluginSettingsHeader
        icon={Ticket}
        title="Jira"
        description={t('Add Jira issues as detailed cards or minimal blocks.')}
      >
        <button
          type="button"
          role="switch"
          aria-label={t('Enable Jira')}
          aria-checked={plugin.enabled}
          className={'setting-switch ' + (plugin.enabled ? 'on' : '')}
          onClick={() =>
            update((workspace) => ({
              ...workspace,
              plugins: {
                ...workspace.plugins,
                jira: { ...workspace.plugins.jira, enabled: !workspace.plugins.jira.enabled },
              },
            }))
          }
        >
          <span />
        </button>
      </PluginSettingsHeader>
      {configuration ? (
        <>
          <div className="jira-server-toolbar">
            {connections.length > 0 && (
              <PopoverPicker
                label={t('Jira server')}
                value={active ?? ''}
                options={connections.map((item) => ({
                  value: item.id,
                  label: item.name || item.baseUrl || t('New server'),
                }))}
                onChange={setSelected}
              />
            )}
            <button
              type="button"
              className="button"
              disabled={connections.length >= jiraConnectionLimit}
              onClick={() => {
                const next = newConnection()
                setDrafts((items) => [...items, next])
                setSelected(next.id)
              }}
            >
              <Plus size={14} />
              {t('Add server')}
            </button>
          </div>
          {connections.map((connection) => (
            <JiraConnectionForm
              key={connection.id}
              connection={connection}
              hidden={active !== connection.id}
              onRemove={remove}
            />
          ))}
        </>
      ) : (
        <>
          <div className="plugin-card-actions">
            <button type="button" className="button" onClick={onConfigure}>
              {t('Configure Jira')}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <PluginCommands
            enabled={plugin.enabled}
            commands={[
              { trigger: '/jira', label: 'Add a Jira issue', kind: 'slash' },
              { trigger: '/jira-inline', label: 'Jira issue in text', kind: 'slash' },
            ]}
          />
        </>
      )}
    </div>
  )
}
function newConnection(): JiraConnection {
  return { id: crypto.randomUUID(), name: '', baseUrl: '', authType: 'pat' }
}
function JiraConnectionForm({
  connection,
  hidden,
  onRemove,
}: {
  connection: JiraConnection
  hidden: boolean
  onRemove: (connection: JiraConnection) => Promise<void>
}) {
  const { w, update, flush } = useApp()
  const { t } = useI18n()
  const plugin = w!.plugins.jira
  const savedConnection = plugin.connections.find((item) => item.id === connection.id)
  const baseline = useRef(JSON.stringify(savedConnection))
  const [name, setName] = useState(connection.name)
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl)
  const [pat, setPat] = useState('')
  const [authType, setAuthType] = useState(connection.authType)
  const [email, setEmail] = useState('')
  const [savedEmail, setSavedEmail] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const statusGeneration = useRef(0)
  const current = useRef(w)
  current.current = w
  const cloud = authType !== 'pat'
  const parsedAddress = jiraBaseUrlSchema.safeParse(baseUrl)
  const matchingToken =
    hasToken &&
    authType === savedConnection?.authType &&
    parsedAddress.success &&
    normalizeJiraBaseUrl(parsedAddress.data, authType) === savedConnection?.baseUrl &&
    (cloud ? email.trim() === savedEmail : true)
  useEffect(() => {
    let active = true
    const generation = ++statusGeneration.current
    if (!savedConnection) return
    window.sheco
      .jiraStatus(w!.id, savedConnection?.baseUrl)
      .then((status) => {
        if (active && generation === statusGeneration.current) {
          setHasToken(status.hasToken)
          setSavedEmail(status.email ?? '')
          setEmail((draft) => draft || status.email || '')
        }
      })
      .catch((error) => {
        if (active && generation === statusGeneration.current) setError(t(jiraErrorMessage(error)))
      })
    return () => {
      active = false
    }
  }, [w!.id, savedConnection?.baseUrl, savedConnection?.authType])
  const save = async () => {
    const parsed = jiraBaseUrlSchema.safeParse(baseUrl)
    if (!parsed.success) {
      setError(t('Enter a Jira address without credentials, query or fragment.'))
      return
    }
    const address = normalizeJiraBaseUrl(parsed.data, authType)
    if (!jiraConnectionUrlSchema.safeParse(address).success) {
      setError(t('Use HTTPS for Jira. HTTP is allowed only on this computer.'))
      return
    }
    if (authType === 'cloud-scoped') {
      const url = new URL(address)
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net') || url.port) {
        setError(t('Scoped API tokens require an HTTPS atlassian.net site address.'))
        return
      }
    }
    if (cloud && !jiraEmailSchema.safeParse(email).success) {
      setError(t('Enter the Atlassian account email used to create the API token.'))
      return
    }
    if (!pat.trim() && (!matchingToken || address !== savedConnection?.baseUrl)) {
      setError(t(cloud ? 'Enter a Jira API token.' : 'Enter a Jira PAT.'))
      return
    }
    if (pat.trim() && !jiraPatSchema.safeParse(pat).success) {
      setError(
        t(
          cloud
            ? 'Enter an API token without spaces or control characters.'
            : 'Enter a Jira PAT without spaces or control characters.',
        ),
      )
      return
    }
    const next = jiraConnectionSchema.parse({ id: connection.id, name, baseUrl: address, authType })
    const workspaceId = w!.id
    const previousAddress = savedConnection?.baseUrl
    setBusy(true)
    setError('')
    setMessage('')
    try {
      update((workspace) => {
        if (
          workspace.id !== workspaceId ||
          JSON.stringify(
            workspace.plugins.jira.connections.find((item) => item.id === connection.id),
          ) !== baseline.current
        )
          throw new Error('The Jira configuration changed. Try again.')
        if (
          workspace.plugins.jira.connections.some(
            (item) => item.id !== connection.id && item.baseUrl === address,
          )
        )
          throw new Error('This Jira server is already configured.')
        const connections = savedConnection
          ? workspace.plugins.jira.connections.map((item) =>
              item.id === connection.id ? next : item,
            )
          : [...workspace.plugins.jira.connections, next]
        if (connections.length > jiraConnectionLimit)
          throw new Error('You can connect up to 20 Jira servers.')
        return {
          ...workspace,
          plugins: { ...workspace.plugins, jira: { ...workspace.plugins.jira, connections } },
        }
      })
      baseline.current = JSON.stringify(next)
      await flush()
      if (current.current?.id !== workspaceId) return
      if (pat.trim())
        await window.sheco.configureJira({
          workspaceId,
          baseUrl: address,
          credentials:
            authType === 'pat'
              ? { type: 'pat', pat: pat.trim() }
              : { type: authType, email: email.trim(), apiToken: pat.trim() },
        })
      if (current.current?.id !== workspaceId) return
      if (
        previousAddress &&
        previousAddress !== address &&
        !current.current.plugins.jira.connections.some((item) => item.baseUrl === previousAddress)
      )
        await window.sheco.forgetJiraToken(workspaceId, previousAddress)
      ++statusGeneration.current
      setPat('')
      setName(next.name)
      setBaseUrl(address)
      setSavedEmail(cloud ? email.trim() : '')
      setHasToken(true)
      setMessage(t('Jira settings saved'))
    } catch (error) {
      setError(t(jiraErrorMessage(error)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="jira-configuration"
      hidden={hidden}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label>
        {t('Server name (optional)')}
        <input
          aria-label={t('Server name (optional)')}
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t('Jira connection')}
        <PopoverPicker
          label={t('Jira connection')}
          value={authType}
          options={[
            { value: 'pat', label: t('Server / Data Center · PAT') },
            { value: 'cloud', label: t('Cloud · API token') },
            { value: 'cloud-scoped', label: t('Cloud · API token with scopes') },
          ]}
          onChange={(value) => {
            if (busy) return
            setAuthType(value as JiraAuthType)
            setPat('')
            setError('')
            setMessage('')
          }}
        />
      </label>
      <label>
        {t('Jira address')}
        <input
          aria-label={t('Jira address')}
          placeholder={cloud ? 'https://your-site.atlassian.net' : 'https://jira.example.com'}
          value={baseUrl}
          maxLength={2000}
          disabled={busy}
          onChange={(event) => {
            setBaseUrl(event.target.value)
            if (authType === 'pat' && /\.atlassian\.net(?:\/|$)/i.test(event.target.value)) {
              setAuthType('cloud')
              setPat('')
            }
          }}
        />
      </label>
      {cloud && (
        <label>
          {t('Atlassian email')}
          <input
            aria-label={t('Atlassian email')}
            autoComplete="username"
            value={email}
            maxLength={320}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      )}
      <label>
        <span className="jira-token-label">
          {t(cloud ? 'Jira API token' : 'Jira PAT')}
          {matchingToken && <LockKeyhole size={13} aria-label={t('Token saved')} />}
        </span>
        <input
          aria-label={t(cloud ? 'Jira API token' : 'Jira PAT')}
          type="password"
          autoComplete="new-password"
          value={pat}
          placeholder={matchingToken ? '************' : ''}
          aria-description={
            matchingToken ? t('Saved token. Type a new token to replace it.') : undefined
          }
          title={matchingToken ? t('Saved token. Type a new token to replace it.') : undefined}
          maxLength={10000}
          disabled={busy}
          onChange={(event) => setPat(event.target.value)}
        />
      </label>
      {error && (
        <p className="jira-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
      <div className="plugin-card-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {t(busy ? 'Saving…' : 'Save Jira settings')}
        </button>
        {hasToken && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              setMessage('')
              try {
                await window.sheco.forgetJiraToken(w!.id, savedConnection?.baseUrl)
                ++statusGeneration.current
                setHasToken(false)
                setPat('')
                setEmail('')
                setSavedEmail('')
                setMessage(t('Jira token removed'))
              } catch (error) {
                setError(t(jiraErrorMessage(error)))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('Remove token')}
          </button>
        )}
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onRemove(connection)
            } catch (error) {
              setError(t(jiraErrorMessage(error)))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Trash2 size={14} />
          {t('Remove server')}
        </button>
      </div>
    </form>
  )
}
