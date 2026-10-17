import { z } from 'zod'
import { architectureProjectSchema, type ArchitectureProject } from './projectArchitecture'

export const architecturePageProjectSchema = architectureProjectSchema.refine(
  (project) => new TextEncoder().encode(JSON.stringify(project)).length <= 8 * 1024 * 1024,
  'Architecture exceeds the document size limit',
)
export const architectureEmbedAttrsSchema = z.strictObject({
  pageId: z.string().uuid(),
  label: z.string().max(500).default('Project architecture'),
})
export function architectureSearchText(project: ArchitectureProject): string {
  return [
    project.name,
    ...project.sites.map((site) => site.name),
    ...(project.groups ?? []).map((group) => group.name),
    ...project.resources.map((resource) => resource.name),
    ...project.objects.flatMap((object) => [
      object.name,
      object.os,
      ...(object.disks ?? []).map((disk) => disk.name),
      ...object.parameters.flatMap((parameter) => [parameter.name, parameter.value]),
    ]),
    ...project.links.map((link) => link.label),
  ]
    .filter(Boolean)
    .join(' ')
}
