import { useState } from 'react'
import { ArrowUpRight, ArrowUpCircle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import { useApp } from '../state'
import { useAppUpdates } from '../appUpdates'

function OpenReleaseButton({ url, compact = false }: { url: string; compact?: boolean }) {
  const { t } = useI18n()
  const { run } = useApp()
  return (
    <button
      className="button"
      aria-label={t('Open release')}
      title={compact ? t('Open release') : undefined}
      onClick={() => run(() => window.sheco.external(url))}
    >
      {!compact && t('Open release')}
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  )
}

export function SidebarUpdateNotice() {
  const { t } = useI18n()
  const { state } = useAppUpdates()
  const release = state?.availableRelease
  if (!release) return null
  return (
    <div className="sidebar-update-notice" role="status">
      <div>
        <ArrowUpCircle size={14} aria-hidden="true" />
        <strong title={t('New version') + ' ' + release.version}>
          {t('New version')} {release.version}
        </strong>
      </div>
      <OpenReleaseButton url={release.url} compact />
    </div>
  )
}

export function AppUpdates() {
  const { t } = useI18n()
  const { run } = useApp()
  const { state, check, configure } = useAppUpdates()
  const [saving, setSaving] = useState(false)
  const result = state?.result
  const checking = !!state?.checking
  const releaseUrl = result?.status === 'available' ? result.releaseUrl : null
  const StatusIcon =
    result?.status === 'current'
      ? CheckCircle2
      : result?.status === 'available'
        ? ArrowUpCircle
        : Info
  return (
    <section className="app-updates" aria-label={t('App updates')}>
      <div className="app-update-heading">
        <div>
          <h3>{t('App updates')}</h3>
          <p className="muted small">
            {t('Installed version')}: {state?.currentVersion || '…'}
          </p>
        </div>
        <button className="button" disabled={!state || checking} onClick={() => run(check)}>
          <RefreshCw size={14} className={checking ? 'is-loading' : ''} />
          {t(checking ? 'Checking for updates…' : 'Check for updates')}
        </button>
      </div>
      <div className="app-update-startup">
        <span id="update-startup-label">{t('Check for updates at startup')}</span>
        <button
          type="button"
          className={'setting-switch ' + (state?.settings.checkOnStartup ? 'on' : '')}
          role="switch"
          aria-labelledby="update-startup-label"
          aria-checked={!!state?.settings.checkOnStartup}
          disabled={!state || saving}
          onClick={() => {
            setSaving(true)
            run(async () => {
              try {
                await configure({ checkOnStartup: !state!.settings.checkOnStartup })
              } finally {
                setSaving(false)
              }
            })
          }}
        >
          <span />
        </button>
      </div>
      {result && (
        <div className={'update-result ' + result.status} role="status">
          <div className="update-result-message">
            <StatusIcon size={18} aria-hidden="true" />
            <div className="update-result-copy">
              <strong>
                {t(
                  result.status === 'available'
                    ? 'A new version is available.'
                    : result.status === 'current'
                      ? 'You are up to date.'
                      : result.status === 'unavailable'
                        ? 'No public release is available.'
                        : result.error === 'rate-limit'
                          ? 'GitHub has limited update checks. Try again later.'
                          : 'Could not check for updates. Try again.',
                )}
              </strong>
              {result.status === 'available' && result.latestVersion && (
                <span>
                  {t('Latest version')}: {result.latestVersion}
                </span>
              )}
            </div>
          </div>
          {releaseUrl && <OpenReleaseButton url={releaseUrl} />}
        </div>
      )}
    </section>
  )
}
