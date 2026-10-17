import { useI18n } from '../i18n'
import { PopoverPicker } from './PopoverPicker'
import {
  architectureBackgrounds,
  architectureBackgroundLabels,
  architectureBackgroundFill,
  type ArchitectureBackground,
} from '../shared/projectArchitecture'

export function ArchitectureBackgroundPicker({
  value,
  onChange,
}: {
  value?: ArchitectureBackground
  onChange: (value: ArchitectureBackground) => void
}) {
  const { t } = useI18n()
  return (
    <label>
      {t('Background')}
      <PopoverPicker
        popoverClassName="architecture-choice-menu"
        label={t('Background')}
        value={value ?? 'default'}
        options={architectureBackgrounds.map((background) => ({
          value: background,
          label: t(architectureBackgroundLabels[background]),
          icon: (
            <span
              className="architecture-color-swatch"
              style={{ background: architectureBackgroundFill(background, true) }}
            />
          ),
        }))}
        onChange={onChange}
      />
    </label>
  )
}
