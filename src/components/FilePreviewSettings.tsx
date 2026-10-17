import { PanelsTopLeft, ArrowUpRight } from 'lucide-react'
import { useApp } from '../state'
import { useI18n } from '../i18n'
import { filePreviewId } from '../shared/filePreview'
import { PopoverPicker } from './PopoverPicker'
import { PluginSettingsHeader } from './PluginSettingsHeader'

export function FilePreviewSettings({
  configuration = false,
  onConfigure,
}: {
  configuration?: boolean
  onConfigure?: () => void
}) {
  const { w, update } = useApp()
  const { t } = useI18n()
  const plugin = w!.plugins.filePreview
  return (
    <div className="plugin-card file-preview-settings">
      <PluginSettingsHeader
        icon={PanelsTopLeft}
        title={t('File preview')}
        description={t('Open PDFs, text files and videos in separate tabs.')}
      >
        <button
          type="button"
          role="switch"
          aria-label={t('Enable file preview')}
          aria-checked={plugin.enabled}
          className={'setting-switch ' + (plugin.enabled ? 'on' : '')}
          onClick={() =>
            update((w) => {
              const enabled = !w.plugins.filePreview.enabled
              const tabs = enabled ? w.ui.tabs : w.ui.tabs.filter((id) => !filePreviewId(id))
              return {
                ...w,
                plugins: { ...w.plugins, filePreview: { ...w.plugins.filePreview, enabled } },
                ui: {
                  ...w.ui,
                  tabs,
                  activeId:
                    w.ui.activeId && !tabs.includes(w.ui.activeId)
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
      {!configuration ? (
        <div className="plugin-card-actions">
          <button className="button" onClick={onConfigure}>
            {t('Configure')}
            <ArrowUpRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="setting-row">
            <strong>{t('Default PDF size')}</strong>
            <PopoverPicker
              label={t('Default PDF size')}
              value={plugin.pdfFit}
              options={[
                { value: 'height', label: t('Fit height') },
                { value: 'width', label: t('Fit width') },
              ]}
              onChange={(value) =>
                update((w) => ({
                  ...w,
                  plugins: {
                    ...w.plugins,
                    filePreview: { ...w.plugins.filePreview, pdfFit: value as 'height' | 'width' },
                  },
                }))
              }
            />
          </div>
          <div className="setting-row">
            <strong>{t('Show PDF navigation on open')}</strong>
            <button
              type="button"
              role="switch"
              aria-label={t('Show PDF navigation on open')}
              aria-checked={plugin.pdfNavigation}
              className={'setting-switch ' + (plugin.pdfNavigation ? 'on' : '')}
              onClick={() =>
                update((w) => ({
                  ...w,
                  plugins: {
                    ...w.plugins,
                    filePreview: {
                      ...w.plugins.filePreview,
                      pdfNavigation: !w.plugins.filePreview.pdfNavigation,
                    },
                  },
                }))
              }
            >
              <span />
            </button>
          </div>
          <p className="muted small">
            {t(
              'PDF up to 64 MB · UTF-8/UTF-16 text up to 4 MB · Video playback depends on the codec.',
            )}
          </p>
        </>
      )}
    </div>
  )
}
