import { useMemo } from 'react'
import { useI18n } from '../i18n'
import { architectureSvg, type ArchitectureProject } from '../shared/projectArchitecture'
import './ProjectArchitecture.css'

export function ArchitectureSnapshot({ project }: { project: ArchitectureProject }) {
  const { t, language } = useI18n()
  const svg = useMemo(() => architectureSvg(project, undefined, t, true), [project, t, language])
  return <div className="architecture-snapshot" dangerouslySetInnerHTML={{ __html: svg }} />
}
