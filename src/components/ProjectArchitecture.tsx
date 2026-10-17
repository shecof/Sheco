import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync, createPortal } from 'react-dom'
import './ProjectArchitecture.css'
import {
  Plus,
  Trash2,
  Network,
  Server,
  Copy,
  Download,
  Search,
  SlidersHorizontal,
  Settings,
} from 'lucide-react'
import { useApp } from '../state'
import { nextTimestamp, type Page } from '../shared/model'
import { architecturePageProjectSchema } from '../shared/architectureDocument'
import { pasteArchitectureSelection } from '../shared/architectureClipboard'
import { ArchitectureSnapshot } from './ArchitectureSnapshot'
import { useI18n } from '../i18n'
import { IconButton, Modal, Popover } from './ui'
import { PopoverPicker } from './PopoverPicker'
import { ArchitectureDiagram } from './ArchitectureDiagram'
import { ArchitectureProperties, type ArchitectureSubject } from './ArchitectureProperties'
import { architectureImageBlob } from './architectureImageExport'
import {
  architectureBalances,
  architectureDiagramLayout,
  architectureNoSite,
  duplicateArchitectureObjects,
  architectureLimits,
  architectureMermaid,
  architectureAllocations,
  architectureProjectSchema,
  architectureSvg,
  architectureTypeLabels,
  architecturePresentation,
  groupArchitectureObjects,
  removeArchitectureObjects,
  removeArchitectureSite,
  removeArchitectureGroup,
  type ArchitectureObject,
  type ArchitectureProject,
  type ArchitecturePoint,
} from '../shared/projectArchitecture'
import {
  prepareArchitectureChange,
  materializeArchitecturePositions,
  snapArchitecturePoint,
  vacantArchitecturePosition,
} from '../shared/architecturePlacement'

type SaveProject = (project: ArchitectureProject) => string | null
const number = (value: number, language: string) =>
  Number.isFinite(value) ? value.toLocaleString(language, { maximumFractionDigits: 3 }) : '—'

function ProjectDialog({
  project,
  isNew,
  onSave,
  onClose,
}: {
  project: ArchitectureProject
  isNew: boolean
  onSave: SaveProject
  onClose: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(() => structuredClone(project))
  const [error, setError] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = architectureProjectSchema.safeParse(draft)
    if (!parsed.success) {
      setError(t('Check the project name and resource amounts.'))
      return
    }
    setError(onSave(parsed.data) ?? '')
  }
  return (
    <Modal
      title={isNew ? 'New architecture project' : 'Project resources'}
      onClose={onClose}
      className="architecture-modal"
      wide
    >
      <form onSubmit={submit}>
        <div className="architecture-form-body">
          <label>
            {t('Project name')}
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="architecture-budget-head">
            <span>{t('Resource')}</span>
            <span>{t('Unit')}</span>
            <span>{t('Capacity')}</span>
          </div>
          {draft.resources.map((resource, index) => (
            <div className="architecture-budget-row" key={resource.id}>
              <input
                aria-label={t('Resource name {number}', { number: index + 1 })}
                required
                maxLength={80}
                value={resource.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    resources: draft.resources.map((r) =>
                      r.id === resource.id ? { ...r, name: e.target.value } : r,
                    ),
                  })
                }
              />
              <PopoverPicker
                popoverClassName="architecture-choice-menu"
                label={t('Resource unit {number}', { number: index + 1 })}
                value={resource.unit}
                options={[
                  { value: 'cores', label: t('cores') },
                  { value: 'GB', label: t('GB') },
                ]}
                onChange={(unit) =>
                  setDraft({
                    ...draft,
                    resources: draft.resources.map((r) =>
                      r.id === resource.id ? { ...r, unit } : r,
                    ),
                  })
                }
              />
              <input
                aria-label={t('Capacity {resource}', { resource: resource.name })}
                type="number"
                min={0}
                max={1_000_000_000}
                step="any"
                required
                value={Number.isNaN(resource.capacity) ? '' : resource.capacity}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    resources: draft.resources.map((r) =>
                      r.id === resource.id ? { ...r, capacity: e.target.valueAsNumber } : r,
                    ),
                  })
                }
              />
              <IconButton
                title={t('Remove resource')}
                onClick={() => {
                  if (draft.resources.length === 1) {
                    setError(t('Keep at least one resource.'))
                    return
                  }
                  if (
                    draft.objects.some((object) => architectureAllocations(object)[resource.id])
                  ) {
                    setError(t('Release this resource from objects before removing it.'))
                    return
                  }
                  setDraft({
                    ...draft,
                    resources: draft.resources.filter((r) => r.id !== resource.id),
                    objects: draft.objects.map((object) => ({
                      ...object,
                      resources: Object.fromEntries(
                        Object.entries(object.resources).filter(([key]) => key !== resource.id),
                      ),
                      ...(object.disks && {
                        disks: object.disks.filter((disk) => disk.resourceId !== resource.id),
                      }),
                    })),
                  })
                  setError('')
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          <button
            type="button"
            className="button"
            disabled={draft.resources.length >= architectureLimits.resources}
            onClick={() =>
              setDraft({
                ...draft,
                resources: [
                  ...draft.resources,
                  { id: `r_${crypto.randomUUID()}`, name: '', unit: 'GB', capacity: 0 },
                ],
              })
            }
          >
            <Plus size={14} />
            {t('Add resource')}
          </button>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="button primary" type="submit">
            {t(isNew ? 'Create project' : 'Save project')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

type ProjectDialogState = { project: ArchitectureProject; isNew: boolean } | null
export function ProjectArchitecture({
  project,
  onSave,
}: {
  project: ArchitectureProject
  onSave: (baseline: ArchitectureProject, next: ArchitectureProject) => string | null
}) {
  const { w, notify, registerNavigationGuard } = useApp()
  const { t, language } = useI18n()
  const [siteId, setSiteId] = useState('')
  const [subject, setSubject] = useState<ArchitectureSubject | null>(null)
  const [propertyPoint, setPropertyPoint] = useState<ArchitecturePoint>({ x: 0, y: 0 })
  const propertyAnchor = useRef<HTMLSpanElement>(null)
  const pageElement = useRef<HTMLElement>(null)
  const propertyContents = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    propertyContents.current
      ?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')
      ?.focus({ preventScroll: true })
  }, [subject?.kind, subject?.id, subject?.section, propertyPoint.x, propertyPoint.y])
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null)
  const [mermaid, setMermaid] = useState<{ name: string; source: string } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number }>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsAnchor = useRef<HTMLButtonElement>(null)
  const flushProperties = useRef<(() => boolean) | null>(null)
  useEffect(
    () => registerNavigationGuard(() => flushProperties.current?.() ?? true),
    [registerNavigationGuard],
  )
  const [exporting, setExporting] = useState(false)
  const exportController = useRef<AbortController | null>(null)
  type HistoryItem = { before: ArchitectureProject; after: string; bytes: number; key?: string }
  const undoHistory = useRef<HistoryItem[]>([])
  const redoHistory = useRef<HistoryItem[]>([])
  const [redoCount, setRedoCount] = useState(0)
  const [undoCount, setUndoCount] = useState(0)
  const selectedSite = project?.sites.find((site) => site.id === siteId)
  const scopeId = siteId === architectureNoSite ? architectureNoSite : selectedSite?.id
  const presentation = project
    ? architecturePresentation(project)
    : { showTitle: true, showResources: true, showBalances: true }
  useEffect(() => {
    redoHistory.current = []
    setRedoCount(0)
    undoHistory.current = []
    setUndoCount(0)
    setSubject(null)
    flushProperties.current = null
  }, [w!.id, project?.id])
  useEffect(() => {
    exportController.current?.abort()
    setExporting(false)
    return () => exportController.current?.abort()
  }, [project, scopeId])
  function applyProject(
    baseline: ArchitectureProject,
    next: ArchitectureProject,
    record = true,
    historyKey?: string,
  ): string | null {
    const parsed = architecturePageProjectSchema.safeParse(next)
    if (!parsed.success) return t('Check the project data or library limits.')
    const error = onSave(baseline, parsed.data)
    if (error) return error
    const applied = parsed.data
    if (record && JSON.stringify(applied) !== JSON.stringify(baseline)) {
      const previous = undoHistory.current.at(-1)
      const after = JSON.stringify(applied)
      const before =
        historyKey && previous?.key === historyKey && previous.after === JSON.stringify(baseline)
          ? undoHistory.current.pop()!.before
          : baseline
      undoHistory.current.push({
        before,
        after,
        key: historyKey,
        bytes: new TextEncoder().encode(JSON.stringify(before) + after).length,
      })
      redoHistory.current = []
      setRedoCount(0)
      while (
        undoHistory.current.length > 30 ||
        undoHistory.current.reduce((sum, item) => sum + item.bytes, 0) > 32 * 1024 * 1024
      )
        undoHistory.current.shift()
      setUndoCount(undoHistory.current.length)
    }
    return null
  }
  function flushEditor() {
    return flushProperties.current?.() ?? true
  }
  function inspect(next: ArchitectureSubject | null, point?: ArchitecturePoint) {
    if (!flushEditor()) return false
    if (next && point) setPropertyPoint(point)
    setSubject(next)
    return true
  }
  function closeProperties() {
    if (inspect(null))
      pageElement.current
        ?.querySelector<HTMLElement>('.architecture-diagram')
        ?.focus({ preventScroll: true })
  }
  function applyAction(baseline: ArchitectureProject, next: ArchitectureProject) {
    const error = applyProject(baseline, prepareArchitectureChange(baseline, next))
    if (error) notify(error)
    return !error
  }
  function undo() {
    if (!project || !flushEditor()) return
    const item = undoHistory.current.at(-1)
    if (!item) return
    if (JSON.stringify(project) !== item.after) {
      notify(t('The project changed. Undo is unavailable.'))
      return
    }
    const error = applyProject(project, item.before, false)
    if (error) {
      notify(error)
      return
    }
    undoHistory.current.pop()
    redoHistory.current.push(item)
    setRedoCount(redoHistory.current.length)
    setUndoCount(undoHistory.current.length)
    setSubject(null)
  }
  function redo() {
    if (!project || !flushEditor()) return
    const item = redoHistory.current.at(-1)
    if (!item) return
    if (JSON.stringify(project) !== JSON.stringify(item.before)) {
      notify(t('The project changed. Undo is unavailable.'))
      return
    }
    const error = applyProject(project, JSON.parse(item.after), false)
    if (error) {
      notify(error)
      return
    }
    redoHistory.current.pop()
    undoHistory.current.push(item)
    setUndoCount(undoHistory.current.length)
    setRedoCount(redoHistory.current.length)
    setSubject(null)
  }
  const nextName = (label: string, existing: { name: string }[]) => {
    let count = 1
    while (existing.some((item) => item.name === `${t(label)} ${count}`)) count++
    return `${t(label)} ${count}`
  }
  function createObject(
    type: ArchitectureObject['type'],
    targetSiteId: string | undefined,
    groupId?: string,
    point?: ArchitecturePoint,
    position?: ArchitecturePoint,
  ) {
    if (!project || !flushEditor() || project.objects.length >= architectureLimits.objects)
      return null
    const layout = architectureDiagramLayout(project, undefined, undefined, false)
    const baseline = materializeArchitecturePositions(project, layout)
    const parent = groupId
      ? layout.groups.find((group) => group.id === groupId)
      : layout.sites.find((site) => site.id === targetSiteId)
    let placed = position
      ? snapArchitecturePoint({
          x: position.x - (parent?.x ?? 0),
          y: position.y - (parent?.y ?? 0),
        })
      : undefined
    if (placed && parent) {
      placed.x = Math.max(groupId ? 16 : 32, placed.x)
      placed.y = Math.max(groupId ? 48 : 64, placed.y)
    }
    if (placed) {
      const height = architecturePresentation(project).showResources ? 144 : 112
      const peers = baseline.objects
        .filter((peer) => peer.siteId === targetSiteId && peer.groupId === groupId)
        .map((peer) => ({ ...peer.position!, width: 288, height }))
      const frames = groupId
        ? []
        : targetSiteId
          ? layout.groups.filter((group) => group.siteId === targetSiteId)
          : [...layout.sites, ...layout.groups.filter((group) => !group.siteId)]
      placed = vacantArchitecturePosition(
        { ...placed, width: 288, height },
        [
          ...peers,
          ...frames.map((frame) => ({
            ...frame,
            x: frame.x - (parent?.x ?? 0),
            y: frame.y - (parent?.y ?? 0),
          })),
        ],
        parent ? { x: groupId ? 16 : 32, y: groupId ? 48 : 64 } : undefined,
      )
    }
    const object: ArchitectureObject = {
      id: crypto.randomUUID(),
      ...(targetSiteId && { siteId: targetSiteId }),
      ...(placed && { position: placed }),
      type,
      name: nextName(architectureTypeLabels[type], project.objects),
      os: '',
      resources: {},
      disks: [],
      parameters: [],
      ...(groupId ? { groupId } : {}),
    }
    if (!applyAction(project, { ...baseline, objects: [...baseline.objects, object] })) return null
    setSubject({ kind: 'object', id: object.id })
    if (point) setPropertyPoint(point)
    return object.id
  }
  function createSite(point?: ArchitecturePoint, position?: ArchitecturePoint) {
    if (!project || !flushEditor() || project.sites.length >= architectureLimits.sites) return null
    const layout = architectureDiagramLayout(project, undefined, undefined, false)
    const baseline = materializeArchitecturePositions(project, layout)
    const placed = position ? snapArchitecturePoint(position) : undefined
    if (placed)
      while (
        [
          ...layout.sites,
          ...layout.groups.filter((group) => !group.siteId),
          ...layout.nodes.filter((node) => !node.object.siteId && !node.object.groupId),
        ].some(
          (box) =>
            placed.x < box.x + box.width + 16 &&
            placed.x + 368 > box.x &&
            placed.y < box.y + box.height + 16 &&
            placed.y + 176 > box.y,
        )
      )
        placed.x += 416
    const site = {
      id: crypto.randomUUID(),
      name: nextName('Site', project.sites),
      ...(placed && { position: placed }),
    }
    if (!applyAction(project, { ...baseline, sites: [...baseline.sites, site] })) return null
    setSiteId('')
    setSubject({ kind: 'site', id: site.id })
    if (point) setPropertyPoint(point)
    return site.id
  }
  function createGroup(
    targetSiteId: string | undefined,
    ids: string[] = [],
    point?: ArchitecturePoint,
  ) {
    if (!project || !flushEditor() || (project.groups?.length ?? 0) >= architectureLimits.groups)
      return null
    const name = nextName('Group', project.groups ?? [])
    try {
      const next = ids.length
        ? groupArchitectureObjects(project, ids, name)
        : {
            ...project,
            groups: [
              ...(project.groups ?? []),
              { id: crypto.randomUUID(), name, ...(targetSiteId && { siteId: targetSiteId }) },
            ],
          }
      if (!applyAction(project, next)) return null
      const group = next.groups!.at(-1)!
      setSubject({ kind: 'group', id: group.id })
      if (point) setPropertyPoint(point)
      return group.id
    } catch {
      notify(t('Choose objects on the same site or outside sites.'))
      return null
    }
  }
  function removeObjects(ids: string[]) {
    if (!project || !flushEditor()) return false
    if (!applyAction(project, removeArchitectureObjects(project, new Set(ids)))) return false
    setSubject(null)
    return true
  }
  function removeSubject(target: ArchitectureSubject) {
    if (!project) return
    const next =
      target.kind === 'object'
        ? removeArchitectureObjects(project, new Set([target.id]))
        : target.kind === 'site'
          ? removeArchitectureSite(project, target.id)
          : target.kind === 'group'
            ? removeArchitectureGroup(project, target.id)
            : { ...project, links: project.links.filter((link) => link.id !== target.id) }
    if (applyAction(project, next)) {
      flushProperties.current = null
      setSubject(null)
    }
  }
  function place(baseline: ArchitectureProject, next: ArchitectureProject) {
    return flushEditor() && applyAction(baseline, next)
  }
  function duplicate(ids: string[]) {
    if (!project || !flushEditor()) return null
    try {
      const result = duplicateArchitectureObjects(
        project,
        ids,
        (name, count) =>
          t('Copy of {name}', { name: name.slice(0, 96) }) + (count > 1 ? ` ${count}` : ''),
      )
      if (!applyAction(project, result.project)) return null
      setSubject(null)
      return result.ids
    } catch {
      notify(t('Check the project data or library limits.'))
      return null
    }
  }
  function paste(text: string) {
    if (!project || !flushEditor()) return null
    try {
      const result = pasteArchitectureSelection(
        project,
        text,
        selectedSite?.id,
        (name, count) =>
          t('Copy of {name}', { name: name.slice(0, 96) }) + (count > 1 ? ` ${count}` : ''),
      )
      if (!applyAction(project, result.project)) return null
      setSubject(null)
      return result
    } catch {
      notify(t('Cannot paste architecture items. Check resource pools and project limits.'))
      return null
    }
  }
  function connect(from: string, to: string) {
    if (!project || from === to || !flushEditor()) return null
    const existing = project.links.find((link) => link.from === from && link.to === to)
    if (existing) {
      return existing.id
    }
    if (project.links.length >= architectureLimits.links) return null
    const link = { id: crypto.randomUUID(), from, to, label: '' }
    if (!applyAction(project, { ...project, links: [...project.links, link] })) return null
    setSubject(null)
    return link.id
  }
  function reconnect(
    baseline: ArchitectureProject,
    id: string,
    endpoint: 'from' | 'to',
    objectId: string,
  ) {
    if (!flushEditor()) return false
    const link = baseline.links.find((link) => link.id === id)
    if (!link) return false
    const next = { ...link, [endpoint]: objectId }
    if (next.from === link.from && next.to === link.to) return true
    if (
      next.from === next.to ||
      baseline.links.some(
        (item) => item.id !== id && item.from === next.from && item.to === next.to,
      )
    )
      return false
    return applyAction(baseline, {
      ...baseline,
      links: baseline.links.map((item) => (item.id === id ? next : item)),
    })
  }
  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
  async function exportDiagram(format: string) {
    if (!project || exporting || !flushEditor()) return
    const name = project.name + (selectedSite ? `-${selectedSite.name}` : '')
    if (format === 'mermaid') {
      setMermaid({ name, source: architectureMermaid(project, scopeId, t) })
      return
    }
    const source = architectureSvg(project, scopeId, t)
    if (format === 'svg') {
      downloadBlob(new Blob([source], { type: 'image/svg+xml' }), name + '.svg')
      return
    }
    if (!['png', 'jpg'].includes(format)) return
    const controller = new AbortController()
    exportController.current?.abort()
    exportController.current = controller
    setExporting(true)
    try {
      const blob = await architectureImageBlob(source, format as 'png' | 'jpg', controller.signal)
      if (!controller.signal.aborted) downloadBlob(blob, name + '.' + format)
    } catch {
      if (!controller.signal.aborted) notify(t('Could not export the diagram. Try again.'))
    } finally {
      if (exportController.current === controller) setExporting(false)
    }
  }
  return (
    <section ref={pageElement} className="architecture-page" aria-label={t('Project architecture')}>
      <div className="architecture-heading">
        <div>
          <span className="architecture-eyebrow">
            <Network size={15} />
            {project.name}
          </span>
          <h1>
            <PopoverPicker
              popoverClassName="architecture-choice-menu"
              className="architecture-site-picker"
              label={t('Architecture site')}
              value={scopeId ?? ''}
              options={[
                { value: '', label: t('All sites') },
                { value: architectureNoSite, label: t('No site') },
                ...project.sites.map((site) => ({ value: site.id, label: site.name })),
              ]}
              searchPlaceholder={t('Search sites')}
              onChange={(id) => {
                if (inspect(null)) setSiteId(id)
              }}
            />
          </h1>
        </div>
        <div className="architecture-heading-actions">
          {project && (
            <button
              className="button"
              onClick={() => {
                if (flushEditor()) setProjectDialog({ project, isNew: false })
              }}
            >
              <SlidersHorizontal size={15} />
              {t('Project resources')}
            </button>
          )}
          {project && (
            <button
              ref={settingsAnchor}
              className="button architecture-header-icon"
              aria-label={t('Display settings')}
              title={t('Display settings')}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              <Settings size={17} />
            </button>
          )}
          <div className="architecture-export-actions">
            <PopoverPicker
              popoverClassName="architecture-choice-menu"
              label={t('Find object')}
              value=""
              selectedLabel={
                <>
                  <Search size={17} />
                </>
              }
              iconOnly
              className="architecture-icon-picker"
              searchPlaceholder={t('Search objects')}
              options={project.objects.map((object) => ({
                value: object.id,
                label: `${object.name} · ${project.sites.find((site) => site.id === object.siteId)?.name ?? t('No site')}`,
              }))}
              onChange={(id) => {
                if (!inspect(null)) return
                const object = project.objects.find((object) => object.id === id)
                if (!object) return
                if (scopeId && object.siteId !== scopeId) setSiteId('')
                setFocusRequest({ id, sequence: Date.now() })
              }}
            />
            <PopoverPicker
              popoverClassName="architecture-choice-menu"
              label={t('Export diagram')}
              value={exporting ? t('Exporting…') : t('Export')}
              className="architecture-icon-picker"
              iconOnly
              selectedLabel={<Download size={17} />}
              options={[
                { value: 'svg', label: 'SVG' },
                { value: 'mermaid', label: 'Mermaid' },
                { value: 'png', label: 'PNG' },
                { value: 'jpg', label: 'JPG' },
              ]}
              onChange={(format) => void exportDiagram(format)}
            />
          </div>
        </div>
      </div>
      {project && settingsOpen && (
        <Popover
          anchor={settingsAnchor}
          align="end"
          className="architecture-display-settings"
          onClose={() => setSettingsOpen(false)}
        >
          {(['showTitle', 'showResources', 'showBalances'] as const).map((key) => (
            <div className="architecture-display-row" key={key}>
              <span>
                {t(
                  {
                    showTitle: 'Show project title',
                    showResources: 'Show object resources',
                    showBalances: 'Show resource balance',
                  }[key],
                )}
              </span>
              <button
                type="button"
                role="switch"
                aria-label={t(
                  {
                    showTitle: 'Show project title',
                    showResources: 'Show object resources',
                    showBalances: 'Show resource balance',
                  }[key],
                )}
                aria-checked={presentation[key]}
                className={'setting-switch ' + (presentation[key] ? 'on' : '')}
                onClick={() => {
                  if (flushEditor())
                    applyAction(project, {
                      ...project,
                      presentation: { ...presentation, [key]: !presentation[key] },
                    })
                }}
              >
                <span />
              </button>
            </div>
          ))}
        </Popover>
      )}
      <>
        {presentation.showBalances && (
          <>
            <div className="architecture-balances" aria-label={t('Project resource balance')}>
              {architectureBalances(project, scopeId).map((resource) => (
                <div
                  className={'architecture-balance ' + (resource.remaining < 0 ? 'over' : '')}
                  key={resource.id}
                >
                  <div>
                    <strong>{resource.name}</strong>
                    <span>{t(resource.unit)}</span>
                  </div>
                  <p>
                    {number(scopeId ? resource.scopedUsed : resource.used, language)}
                    <span> / {number(resource.capacity, language)}</span>
                  </p>
                  <div className="architecture-meter">
                    <span
                      style={{
                        width: `${resource.capacity ? Math.min(100, (resource.used / resource.capacity) * 100) : resource.used ? 100 : 0}%`,
                      }}
                    />
                  </div>
                  <small>
                    {t('Free in project: {amount}', {
                      amount: number(resource.remaining, language),
                    })}
                  </small>
                </div>
              ))}
            </div>
            {architectureBalances(project).some((resource) => resource.remaining < 0) && (
              <p className="architecture-warning" role="status">
                {t('Capacity exceeded')}
              </p>
            )}
          </>
        )}
        <div className="architecture-editor">
          <ArchitectureDiagram
            project={project}
            siteId={scopeId}
            subject={subject}
            focusRequest={focusRequest}
            onInspect={inspect}
            onCreateObject={createObject}
            onCreateGroup={createGroup}
            onCreateSite={createSite}
            onConnect={connect}
            onReconnect={reconnect}
            onPlace={place}
            onDuplicate={duplicate}
            onPaste={paste}
            onDeleteObjects={removeObjects}
            onDeleteSubject={removeSubject}
            onUndo={undo}
            onRedo={redo}
            canRedo={!!redoCount}
            canUndo={!!undoCount}
          />
          {createPortal(
            <span
              ref={propertyAnchor}
              className="architecture-context-anchor"
              aria-hidden="true"
              style={{ left: propertyPoint.x, top: propertyPoint.y }}
            />,
            document.body,
          )}
          {subject && (
            <Popover
              anchor={propertyAnchor}
              side="right"
              className={
                'architecture-properties-popover ' +
                (subject.kind === 'link' ? 'is-link-label' : '')
              }
              onClose={closeProperties}
            >
              <div ref={propertyContents}>
                <ArchitectureProperties
                  key={`${w!.id}:${project.id}:${subject.kind}:${subject.id}`}
                  project={project}
                  subject={subject}
                  onSectionChange={(section) => inspect({ ...subject, section })}
                  onSave={(baseline, next, key) => applyProject(baseline, next, true, key)}
                  onClose={closeProperties}
                  onDelete={removeSubject}
                  registerFlush={flushProperties}
                />
              </div>
            </Popover>
          )}
        </div>
      </>
      {projectDialog && (
        <ProjectDialog
          project={projectDialog.project}
          isNew={projectDialog.isNew}
          onClose={() => setProjectDialog(null)}
          onSave={(next) => {
            const error = applyProject(projectDialog.project, next)
            if (!error) setProjectDialog(null)
            return error
          }}
        />
      )}
      {mermaid && (
        <Modal title="Mermaid" onClose={() => setMermaid(null)} className="architecture-modal" wide>
          <div className="architecture-form-body">
            <textarea
              className="architecture-mermaid-source"
              aria-label={t('Mermaid source')}
              readOnly
              value={mermaid.source}
            />
          </div>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                void window.sheco
                  .copyText(mermaid.source)
                  .then(() => notify(t('Diagram code copied.')))
                  .catch(() => notify(t('Could not copy. Try again.')))
              }}
            >
              <Copy size={14} />
              {t('Copy Mermaid')}
            </button>
            <button
              className="button primary"
              onClick={() =>
                downloadBlob(
                  new Blob([mermaid.source], { type: 'text/plain;charset=utf-8' }),
                  mermaid.name + '.mmd',
                )
              }
            >
              <Download size={14} />
              {t('Download Mermaid')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
function ArchitecturePrintSnapshot({ page }: { page: Page }) {
  const [printing, setPrinting] = useState(() => window.matchMedia('print').matches)
  useEffect(() => {
    const media = window.matchMedia('print')
    const show = () => flushSync(() => setPrinting(true))
    const hide = () => flushSync(() => setPrinting(false))
    const change = () => (media.matches ? show() : hide())
    media.addEventListener('change', change)
    window.addEventListener('beforeprint', show)
    window.addEventListener('afterprint', hide)
    return () => {
      media.removeEventListener('change', change)
      window.removeEventListener('beforeprint', show)
      window.removeEventListener('afterprint', hide)
    }
  }, [])
  return printing && page.architecture ? (
    <section className="architecture-page-print">
      <h1>{page.title}</h1>
      <ArchitectureSnapshot project={page.architecture} />
    </section>
  ) : null
}
export function ArchitecturePage({ page }: { page: Page }) {
  const { w, update } = useApp()
  const { t } = useI18n()
  const project = page.architecture
  if (!project) return null
  const save = (baseline: ArchitectureProject, next: ArchitectureProject) => {
    let applied = false
    update((current) => {
      if (current.id !== w!.id || !current.plugins.projectArchitecture.enabled) return current
      const owner = current.pages.find(
        (owner) => owner.id === page.id && owner.kind === 'architecture' && !owner.deletedAt,
      )
      if (!owner || JSON.stringify(owner.architecture) !== JSON.stringify(baseline)) return current
      applied = true
      return {
        ...current,
        pages: current.pages.map((owner) =>
          owner.id === page.id
            ? {
                ...owner,
                title: next.name,
                architecture: next,
                updatedAt: nextTimestamp(owner.updatedAt),
              }
            : owner,
        ),
      }
    })
    return applied ? null : t('The project changed. Reopen the form before saving.')
  }
  return (
    <>
      {w!.plugins.projectArchitecture.enabled ? (
        <ProjectArchitecture project={project} onSave={save} />
      ) : (
        <section className="architecture-disabled">
          <h1>{page.title}</h1>
          <ArchitectureSnapshot project={project} />
          <p>{t('Enable project architecture to edit this page.')}</p>
        </section>
      )}
      <ArchitecturePrintSnapshot page={page} />
    </>
  )
}
