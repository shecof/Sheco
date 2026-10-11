import { useI18n } from '../i18n'
import { useApp } from '../state'

export function ReadingSettings() {
  const { t } = useI18n()
  const { w, update } = useApp()
  if (!w) return null
  return (
    <div className="reading-settings">
      {(
        [
          ['showOutline', 'Table of contents'],
          ['fixedWidth', 'Fixed content width'],
        ] as const
      ).map(([key, label]) => (
        <div className="reading-setting" key={key}>
          <span>{t(label)}</span>
          <button
            type="button"
            className={'setting-switch ' + (w.ui[key] ? 'on' : '')}
            role="switch"
            aria-label={t(label)}
            aria-checked={w.ui[key]}
            onClick={() => update((w) => ({ ...w, ui: { ...w.ui, [key]: !w.ui[key] } }))}
          >
            <span />
          </button>
        </div>
      ))}
      <div className="reading-setting font-size-setting">
        <span>{t('Font size')}</span>
        <div className="font-size-options" role="group" aria-label={t('Font size')}>
          {[-2, -1, 0, 1, 2].map((size) => (
            <button
              key={size}
              type="button"
              aria-label={t('Font size {size}', { size: size > 0 ? `+${size}` : size })}
              aria-pressed={w.ui.fontSize === size}
              onClick={() => update((w) => ({ ...w, ui: { ...w.ui, fontSize: size } }))}
            >
              {size > 0 ? `+${size}` : size}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
