import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function PluginSettingsHeader({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="plugin-card-title">
      <span className="plugin-mark" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="plugin-card-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}
