import { Database, Globe, Plus, Server, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { IconButton } from './ui'
import {
  useArchitectureDraft,
  type ArchitectureSave,
  type ArchitectureFlush,
} from './useArchitectureDraft'
import {
  architectureObjectSections,
  type ArchitectureObjectSection,
} from './architecturePropertySections'
import { EditablePopoverPicker, PopoverPicker } from './PopoverPicker'
import {
  architectureAllocations,
  architectureBalances,
  architectureDiskPools,
  architectureLimits,
  architectureObjectDraft,
  architectureObjectTypes,
  architectureTypeLabels,
  type ArchitectureObject,
  type ArchitectureProject,
} from '../shared/projectArchitecture'

const icons = { server: Server, database: Database, website: Globe }
export function ArchitectureObjectEditor({
  project,
  initial,
  section,
  onSectionChange,
  onSave,
  onClose,
  registerFlush,
}: {
  project: ArchitectureProject
  initial: ArchitectureObject
  section: ArchitectureObjectSection
  onSectionChange: (section: ArchitectureObjectSection) => void
  onSave: ArchitectureSave
  onClose: () => void
  registerFlush: ArchitectureFlush
}) {
  const { t, language } = useI18n()
  const state = useArchitectureDraft(
    project,
    {
      object: architectureObjectDraft(project, initial),
    },
    (baseline, value) => ({
      ...baseline,
      objects: baseline.objects.map((object) =>
        object.id !== initial.id
          ? object
          : {
              ...value.object,
              ...(object.siteId === value.object.siteId && object.groupId === value.object.groupId
                ? { position: object.position }
                : {}),
            },
      ),
    }),
    onSave,
    registerFlush,
    'Check the object name, parameters and resources.',
  )
  const { object: draft } = state.draft
  const setDraft = (object: ArchitectureObject) => state.setDraft({ ...state.draft, object })
  const error = state.error
  const pools = architectureDiskPools(project)
  const balances = architectureBalances({
    ...project,
    objects: project.objects.filter((object) => object.id !== initial.id),
  })
  const allocations = architectureAllocations(draft)
  const setDisk = (id: string, patch: Partial<NonNullable<ArchitectureObject['disks']>[number]>) =>
    setDraft({
      ...draft,
      disks: draft.disks!.map((disk) => (disk.id === id ? { ...disk, ...patch } : disk)),
    })
  return (
    <section className="architecture-inspector" aria-label={t('Object properties')}>
      <header>
        <PopoverPicker
          popoverClassName="architecture-choice-menu"
          label={t('Property section')}
          value={section}
          options={Object.entries(architectureObjectSections).map(([value, label]) => ({
            value: value as ArchitectureObjectSection,
            label: t(label),
          }))}
          onChange={onSectionChange}
        />
        <IconButton title={t('Close properties')} onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          state.flush()
        }}
      >
        <div className="architecture-form-body">
          <label>
            {t('Object name')}
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          {section === 'general' && (
            <>
              <div className="architecture-two-fields">
                <label>
                  {t('Object type')}
                  <PopoverPicker
                    popoverClassName="architecture-choice-menu"
                    label={t('Object type')}
                    value={draft.type}
                    options={architectureObjectTypes.map((type) => {
                      const Icon = icons[type]
                      return {
                        value: type,
                        label: t(architectureTypeLabels[type]),
                        icon: <Icon size={15} />,
                      }
                    })}
                    onChange={(type) => setDraft({ ...draft, type })}
                  />
                </label>
                <label>
                  {t('Site')}
                  <PopoverPicker
                    popoverClassName="architecture-choice-menu"
                    label={t('Site')}
                    value={draft.siteId ?? ''}
                    options={[
                      { value: '', label: t('No site') },
                      ...project.sites.map((site) => ({ value: site.id, label: site.name })),
                    ]}
                    searchPlaceholder={t('Search sites')}
                    onChange={(siteId) => {
                      if (siteId === (draft.siteId ?? '')) return
                      const next = { ...draft, siteId: siteId || undefined }
                      delete next.position
                      if (!siteId) delete next.siteId
                      if (
                        !project.groups?.some(
                          (group) => group.id === next.groupId && group.siteId === next.siteId,
                        )
                      )
                        delete next.groupId
                      setDraft(next)
                    }}
                  />
                </label>
              </div>
              {project.groups?.some((group) => group.siteId === draft.siteId) && (
                <label>
                  {t('Group')}
                  <PopoverPicker
                    popoverClassName="architecture-choice-menu"
                    label={t('Group')}
                    value={draft.groupId ?? ''}
                    options={[
                      { value: '', label: t('No group') },
                      ...project.groups
                        .filter((group) => group.siteId === draft.siteId)
                        .map((group) => ({ value: group.id, label: group.name })),
                    ]}
                    searchPlaceholder={t('Search groups')}
                    onChange={(groupId) => {
                      if (groupId === (draft.groupId ?? '')) return
                      const next = { ...draft }
                      delete next.position
                      if (groupId) next.groupId = groupId
                      else delete next.groupId
                      setDraft(next)
                    }}
                  />
                </label>
              )}
              <div className="architecture-os-section">
                <label>{t('Operating system')}</label>
                <EditablePopoverPicker
                  label={t('Operating system')}
                  maxLength={120}
                  placeholder={t('Choose or enter an OS')}
                  value={draft.os}
                  popoverClassName="architecture-os-options architecture-choice-menu"
                  options={[
                    'Ubuntu',
                    'Debian',
                    'AlmaLinux',
                    'Rocky Linux',
                    'Windows Server',
                    'FreeBSD',
                  ]}
                  onChange={(os) => setDraft({ ...draft, os })}
                />
              </div>
            </>
          )}
          {section === 'resources' && (
            <>
              <div className="architecture-resource-inputs architecture-compute-inputs">
                {balances
                  .filter((resource) => !pools.some((pool) => pool.id === resource.id))
                  .map((resource) => (
                    <label key={resource.id}>
                      {resource.name} · {t(resource.unit)}
                      <input
                        aria-label={`${resource.name} · ${t(resource.unit)}`}
                        type="number"
                        min={0}
                        max={1_000_000_000}
                        step="any"
                        required
                        value={
                          Number.isNaN(draft.resources[resource.id])
                            ? ''
                            : (draft.resources[resource.id] ?? 0)
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            resources: {
                              ...draft.resources,
                              [resource.id]: event.target.valueAsNumber,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
              <div className="architecture-disks">
                {draft.disks!.map((disk, index) => (
                  <div className="architecture-disk-row" key={disk.id}>
                    <label>
                      {t('Disk {number}', { number: index + 1 })}
                      <PopoverPicker
                        popoverClassName="architecture-choice-menu"
                        label={t('Disk type {number}', { number: index + 1 })}
                        value={disk.resourceId}
                        options={pools.map((pool) => ({ value: pool.id, label: pool.name }))}
                        onChange={(resourceId) => setDisk(disk.id, { resourceId })}
                      />
                    </label>
                    <label>
                      {t('Size')} · {t('GB')}
                      <input
                        aria-label={t('Disk size {number}', { number: index + 1 })}
                        type="number"
                        min={0}
                        max={1_000_000_000}
                        step="any"
                        required
                        value={Number.isNaN(disk.capacity) ? '' : disk.capacity}
                        onChange={(event) =>
                          setDisk(disk.id, { capacity: event.target.valueAsNumber })
                        }
                      />
                    </label>
                    <IconButton
                      title={t('Remove disk')}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          disks: draft.disks!.filter((item) => item.id !== disk.id),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                    <input
                      className="architecture-disk-name"
                      aria-label={t('Disk name {number}', { number: index + 1 })}
                      placeholder={t('Disk name (optional)')}
                      maxLength={80}
                      value={disk.name}
                      onChange={(event) => setDisk(disk.id, { name: event.target.value })}
                    />
                  </div>
                ))}
                {!!pools.length && draft.disks!.length < architectureLimits.disks && (
                  <PopoverPicker
                    popoverClassName="architecture-choice-menu"
                    label={t('Add disk')}
                    value={t('Add disk')}
                    className="architecture-add-disk"
                    options={pools.map((pool) => ({ value: pool.id, label: pool.name }))}
                    onChange={(resourceId) =>
                      setDraft({
                        ...draft,
                        disks: [
                          ...draft.disks!,
                          { id: crypto.randomUUID(), resourceId, name: '', capacity: 0 },
                        ],
                      })
                    }
                  />
                )}
              </div>
            </>
          )}
          {section === 'parameters' && (
            <>
              <div>
                {draft.parameters.map((parameter, index) => (
                  <div className="architecture-parameter-row" key={index}>
                    <input
                      aria-label={t('Parameter name {number}', { number: index + 1 })}
                      placeholder={t('Parameter name')}
                      required
                      maxLength={80}
                      value={parameter.name}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          parameters: draft.parameters.map((item, i) =>
                            i === index ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={t('Parameter value {number}', { number: index + 1 })}
                      placeholder={t('Value')}
                      maxLength={1000}
                      value={parameter.value}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          parameters: draft.parameters.map((item, i) =>
                            i === index ? { ...item, value: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <IconButton
                      title={t('Remove parameter')}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          parameters: draft.parameters.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
                <button
                  className="button"
                  type="button"
                  disabled={draft.parameters.length >= 30}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      parameters: [...draft.parameters, { name: '', value: '' }],
                    })
                  }
                >
                  <Plus size={14} />
                  {t('Add parameter')}
                </button>
              </div>
            </>
          )}
          {balances
            .filter((resource) => resource.remaining - (allocations[resource.id] ?? 0) < 0)
            .map((resource) => (
              <p className="architecture-over small" key={resource.id}>
                {t('{resource}: over capacity by {amount}', {
                  resource: resource.name,
                  amount: ((allocations[resource.id] ?? 0) - resource.remaining).toLocaleString(
                    language,
                  ),
                })}
              </p>
            ))}
          {error && (
            <div>
              <p className="error-message" role="alert">
                {error}
              </p>
              <button type="button" className="button" onClick={state.reset}>
                {t('Reset draft')}
              </button>
            </div>
          )}
        </div>
      </form>
    </section>
  )
}
