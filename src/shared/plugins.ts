import { z } from 'zod'
import { builtinTools, builtinToolsV1 } from './pluginTools'

export const commandBuilderTab = 'plugin:command-builder' as const
export const commandBuilderSettingsTab = 'plugin:command-builder-settings' as const
export const pluginJsonLimit = 1024 * 1024
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
const token = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
export const commandParameterSchema = z.strictObject({
  id: identifier,
  label: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(''),
  group: z.string().max(100).default('Parameters'),
  flag: z
    .string()
    .max(80)
    .regex(/^(?:-{1,2}[a-zA-Z0-9][a-zA-Z0-9_-]*)?$/)
    .default(''),
  type: z.enum(['boolean', 'text', 'number', 'choice']).default('text'),
  separator: z.enum(['space', 'equals', 'joined']).default('space'),
  position: z.enum(['option', 'argument']).default('option'),
  required: z.boolean().default(false),
  repeatable: z.boolean().default(false),
  placeholder: z.string().max(300).default(''),
  choices: z
    .array(z.strictObject({ label: z.string().min(1).max(100), value: token }))
    .max(100)
    .default([]),
  exclusiveGroup: z.string().max(80).default(''),
})
export type CommandParameter = z.infer<typeof commandParameterSchema>
export const commandOutputPresetSchema = z.strictObject({
  id: identifier,
  label: z.string().trim().min(1).max(100),
  shell: z.enum(['posix', 'powershell', 'any']).default('posix'),
  stages: z.array(z.array(token).min(1).max(30)).min(1).max(10),
})
export type CommandOutputPreset = z.infer<typeof commandOutputPresetSchema>
export const commandToolSchema = z
  .strictObject({
    id: identifier,
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).default(''),
    command: z.array(token).min(1).max(10),
    documentation: z
      .string()
      .max(1000)
      .refine((value) => !value || /^https?:\/\/[^\s]+$/.test(value))
      .default(''),
    parameters: z.array(commandParameterSchema).max(100),
    outputPresets: z.array(commandOutputPresetSchema).max(30).default([]),
  })
  .superRefine((tool, ctx) => {
    if (new Set(tool.outputPresets.map((p) => p.id)).size !== tool.outputPresets.length)
      ctx.addIssue({
        code: 'custom',
        path: ['outputPresets'],
        message: 'Duplicate output preset identifiers',
      })
    if (new Set(tool.parameters.map((p) => p.id)).size !== tool.parameters.length)
      ctx.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Duplicate parameter identifiers',
      })
    tool.parameters.forEach((p, index) => {
      const invalid = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['parameters', index], message })
      if (p.type === 'boolean' && (!p.flag || p.repeatable || p.position === 'argument'))
        invalid('A switch needs a flag and cannot be a repeated argument')
      if (p.position === 'argument' && p.flag) invalid('Positional arguments cannot have a flag')
      if (p.separator !== 'space' && !p.flag) invalid('This separator needs a flag')
      if (
        p.type === 'choice' &&
        (!p.choices.length || new Set(p.choices.map((c) => c.value)).size !== p.choices.length)
      )
        invalid('Choices must be nonempty and unique')
    })
  })
export type CommandTool = z.infer<typeof commandToolSchema>
export const commandBuilderConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    pluginId: z.literal('command-builder'),
    tools: z.array(commandToolSchema).min(1).max(100),
  })
  .superRefine((config, ctx) => {
    if (new Set(config.tools.map((tool) => tool.id)).size !== config.tools.length)
      ctx.addIssue({ code: 'custom', path: ['tools'], message: 'Duplicate tool identifiers' })
  })
export type CommandBuilderConfig = z.infer<typeof commandBuilderConfigSchema>
export const defaultCommandBuilderConfig = (): CommandBuilderConfig =>
  commandBuilderConfigSchema.parse({
    schemaVersion: 1,
    pluginId: 'command-builder',
    tools: builtinTools,
  })
const currentCatalogRevision = 2
const originalTools = new Map(
  builtinToolsV1.map((tool) => [tool.id, commandToolSchema.parse(tool)]),
)
const updatedTools = new Map(builtinTools.map((tool) => [tool.id, commandToolSchema.parse(tool)]))
export const pluginsSchema = z.object({
  commandBuilder: z
    .object({
      enabled: z.boolean().default(false),
      config: commandBuilderConfigSchema.default(defaultCommandBuilderConfig),
      catalogRevision: z.number().int().min(1).max(currentCatalogRevision).default(1),
    })
    .default(() => ({
      enabled: false,
      config: defaultCommandBuilderConfig(),
      catalogRevision: currentCatalogRevision,
    }))
    .transform((plugin) => {
      if (plugin.catalogRevision === currentCatalogRevision) return plugin
      // Upgrade only untouched built-ins once. Never restore deletions or overwrite custom/imported data.
      return {
        ...plugin,
        catalogRevision: currentCatalogRevision,
        config: {
          ...plugin.config,
          tools: plugin.config.tools.map((tool) =>
            JSON.stringify(tool) === JSON.stringify(originalTools.get(tool.id))
              ? structuredClone(updatedTools.get(tool.id)!)
              : tool,
          ),
        },
      }
    }),
})
export const defaultPlugins = () => pluginsSchema.parse({})
export function parsePluginJson(text: string): CommandBuilderConfig {
  if (new TextEncoder().encode(text).length > pluginJsonLimit)
    throw new Error('Plugin JSON is limited to 1 MB.')
  return commandBuilderConfigSchema.parse(JSON.parse(text))
}
export type CommandValues = Record<string, { enabled: boolean; value: string }>
export type CommandShell = 'posix' | 'powershell'
export function quoteArgument(value: string, shell: CommandShell): string {
  if (
    value &&
    (shell === 'powershell' ? /^[a-zA-Z0-9_./:-]+$/ : /^[a-zA-Z0-9_@%+=:,./-]+$/).test(value)
  )
    return value
  return (
    "'" +
    (shell === 'powershell' ? value.replace(/'/g, "''") : value.replace(/'/g, "'\"'\"'")) +
    "'"
  )
}
export function buildCommand(
  tool: CommandTool,
  values: CommandValues,
  shell: CommandShell,
  outputPresetId = '',
) {
  const args: string[] = []
  const issues: { id: string; label: string; message: string }[] = []
  const exclusive = new Set<string>()
  const parameters = [
    ...tool.parameters.filter((p) => p.position === 'option'),
    ...tool.parameters.filter((p) => p.position === 'argument'),
  ]
  for (const p of parameters) {
    const state = values[p.id]
    const fail = (message: string) => issues.push({ id: p.id, label: p.label, message })
    if (!state?.enabled) {
      if (p.required) fail('Required parameter')
      continue
    }
    if (p.exclusiveGroup) {
      if (exclusive.has(p.exclusiveGroup)) fail('Conflicting parameters')
      exclusive.add(p.exclusiveGroup)
    }
    if (p.type === 'boolean') {
      args.push(p.flag)
      continue
    }
    const entries = p.repeatable
      ? state.value.split(/\r?\n/).filter((s) => s.trim())
      : [state.value]
    if (!entries.length || entries.some((value) => !value.trim())) {
      fail('Enter a value')
      continue
    }
    for (const value of entries) {
      if (/[\x00-\x1f\x7f]/.test(value)) {
        fail('Control characters are not allowed')
        continue
      }
      if (
        p.type === 'number' &&
        (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
      ) {
        fail('Enter a number')
        continue
      }
      if (p.type === 'choice' && !p.choices.some((c) => c.value === value)) {
        fail('Choose a value')
        continue
      }
      if (!p.flag) args.push(value)
      else if (p.separator === 'space') args.push(p.flag, value)
      else args.push(p.flag + (p.separator === 'equals' ? '=' : '') + value)
    }
  }
  const command = [...tool.command]
  // Avoid the Windows PowerShell curl alias (Invoke-WebRequest).
  if (shell === 'powershell' && command[0] === 'curl') command[0] = 'curl.exe'
  const invocation = (tokens: string[]) =>
    (shell === 'powershell' ? '& ' : '') +
    tokens.map((value) => quoteArgument(value, shell)).join(' ')
  const outputPreset = tool.outputPresets.find((preset) => preset.id === outputPresetId)
  const available = outputPreset && (outputPreset.shell === 'any' || outputPreset.shell === shell)
  if (outputPresetId && !available)
    issues.push({
      id: '@output',
      label: 'Extended output',
      message: 'Output preset is unavailable for this shell',
    })
  return {
    command: [
      invocation([...command, ...args]),
      ...(available ? outputPreset.stages.map(invocation) : []),
    ].join(' | '),
    issues,
  }
}
