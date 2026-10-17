import { X, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { IconButton } from './ui'
import { PopoverPicker } from './PopoverPicker'
import { ArchitectureObjectEditor } from './ArchitectureObjectEditor'
import { ArchitectureBackgroundPicker } from './ArchitectureBackgroundPicker'
import {
  useArchitectureDraft,
  type ArchitectureSave,
  type ArchitectureFlush,
} from './useArchitectureDraft'
import {
  architectureLinkAppearance,
  type ArchitectureGroup,
  type ArchitectureProject,
} from '../shared/projectArchitecture'

import { type ArchitectureObjectSection } from './architecturePropertySections'
export type ArchitectureSubject = {
  kind: 'object' | 'site' | 'group' | 'link'
  id: string
  section?: ArchitectureObjectSection
}
type Props = {
  project: ArchitectureProject
  subject: ArchitectureSubject
  onSave: ArchitectureSave
  onClose: () => void
  onDelete: (subject: ArchitectureSubject) => void
  registerFlush: ArchitectureFlush
  onSectionChange: (section: ArchitectureObjectSection) => void
}
export function ArchitectureProperties(props: Props) {
  if (props.subject.kind === 'link') {
    const link = props.project.links.find((link) => link.id === props.subject.id)
    return link ? <LinkLabel {...props} link={link} /> : null
  }
  const object = props.project.objects.find((object) => object.id === props.subject.id)
  if (props.subject.kind === 'object')
    return object ? (
      <ArchitectureObjectEditor
        project={props.project}
        initial={object}
        section={props.subject.section ?? 'general'}
        onSectionChange={props.onSectionChange}
        onSave={props.onSave}
        onClose={props.onClose}
        registerFlush={props.registerFlush}
      />
    ) : null
  return <EntityProperties {...props} />
}
function EntityProperties({ project, subject, onSave, onClose, onDelete, registerFlush }: Props) {
  const entity =
    subject.kind === 'site'
      ? project.sites.find((site) => site.id === subject.id)
      : project.groups?.find((group) => group.id === subject.id)
  if (!entity) return null
  return (
    <EntityForm
      key={subject.kind + subject.id}
      {...{ project, subject, onSave, onClose, onDelete, registerFlush, entity }}
    />
  )
}
function EntityForm({
  project,
  subject,
  entity,
  onSave,
  onClose,
  onDelete,
  registerFlush,
}: Omit<Props, 'onSectionChange'> & {
  entity: ArchitectureProject['sites'][number] | ArchitectureGroup
}) {
  const { t } = useI18n()
  const state = useArchitectureDraft(
    project,
    { entity },
    (baseline, draft) =>
      subject.kind === 'site'
        ? {
            ...baseline,
            sites: baseline.sites.map((site) =>
              site.id === subject.id ? { ...draft.entity, position: site.position } : site,
            ),
          }
        : {
            ...baseline,
            groups: baseline.groups!.map((group) =>
              group.id === subject.id
                ? { ...(draft.entity as ArchitectureGroup), position: group.position }
                : group,
            ),
          },
    onSave,
    registerFlush,
    'Check the name.',
  )
  const setEntity = (entity: typeof state.draft.entity) =>
    state.setDraft({ ...state.draft, entity })
  const heading =
    subject.kind === 'site'
      ? 'Site properties'
      : subject.kind === 'group'
        ? 'Group properties'
        : 'Connection properties'
  const value = state.draft.entity
  return (
    <section className="architecture-inspector" aria-label={t(heading)}>
      <header>
        <strong>{t(heading)}</strong>
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
          <>
            <label>
              {t(subject.kind === 'site' ? 'Site name' : 'Group name')}
              <input
                required
                maxLength={120}
                value={value.name}
                onChange={(event) => setEntity({ ...value, name: event.target.value })}
              />
            </label>
            <ArchitectureBackgroundPicker
              value={value.background}
              onChange={(background) => setEntity({ ...value, background })}
            />
          </>

          {state.error && (
            <div>
              <p className="error-message" role="alert">
                {state.error}
              </p>
              <button type="button" className="button" onClick={state.reset}>
                {t('Reset draft')}
              </button>
            </div>
          )}
          <button type="button" className="button danger" onClick={() => onDelete(subject)}>
            <Trash2 size={14} />
            {t(
              subject.kind === 'site'
                ? 'Delete site'
                : subject.kind === 'group'
                  ? 'Delete group'
                  : 'Delete connection',
            )}
          </button>
        </div>
      </form>
    </section>
  )
}

function LinkLabel({
  project,
  subject,
  link,
  onSave,
  onClose,
  onDelete,
  registerFlush,
}: Props & { link: ArchitectureProject['links'][number] }) {
  const { t } = useI18n()
  const state = useArchitectureDraft(
    project,
    {
      label: link.label,
      ...architectureLinkAppearance(link),
    },
    (baseline, draft) => ({
      ...baseline,
      links: baseline.links.map((item) => {
        if (item.id !== link.id) return item
        const { bidirectional: _legacy, ...current } = item
        return {
          ...current,
          ...draft,
        }
      }),
    }),
    onSave,
    registerFlush,
    'Check the connection label.',
  )
  return (
    <form
      className="architecture-link-label-editor"
      aria-label={t('Connection label')}
      onSubmit={(event) => {
        event.preventDefault()
        if (state.flush()) onClose()
      }}
    >
      <input
        aria-label={t('Connection label')}
        placeholder={t('Connection label')}
        maxLength={120}
        value={state.draft.label}
        onChange={(event) => state.setDraft({ ...state.draft, label: event.target.value })}
      />
      <div className="architecture-link-menu-row">
        <span>{t('Arrowheads')}</span>
        <PopoverPicker
          label={t('Start arrow')}
          value={state.draft.startArrow}
          popoverClassName="architecture-choice-menu"
          options={[
            { value: 'none', label: t('No arrow') },
            { value: 'arrow', label: '←' },
          ]}
          onChange={(startArrow) => state.setDraft({ ...state.draft, startArrow })}
        />
        <PopoverPicker
          label={t('End arrow')}
          value={state.draft.endArrow}
          popoverClassName="architecture-choice-menu"
          options={[
            { value: 'none', label: t('No arrow') },
            { value: 'arrow', label: '→' },
          ]}
          onChange={(endArrow) => state.setDraft({ ...state.draft, endArrow })}
        />
      </div>
      <div className="architecture-link-menu-row">
        <span>{t('Line style')}</span>
        <PopoverPicker
          label={t('Line style')}
          value={state.draft.lineStyle}
          popoverClassName="architecture-choice-menu"
          options={[
            { value: 'solid', label: t('Solid line') },
            { value: 'dashed', label: t('Dashed line') },
            { value: 'dotted', label: t('Dotted line') },
          ]}
          onChange={(lineStyle) => state.setDraft({ ...state.draft, lineStyle })}
        />
      </div>
      {state.error && (
        <div className="architecture-link-label-error">
          <p className="error-message" role="alert">
            {state.error}
          </p>
          <button className="button" type="button" onClick={state.reset}>
            {t('Reset draft')}
          </button>
        </div>
      )}
      <button type="button" className="menu-item danger" onClick={() => onDelete(subject)}>
        <Trash2 size={15} />
        {t('Delete connection')}
      </button>
    </form>
  )
}
