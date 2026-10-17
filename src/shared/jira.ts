import { z } from 'zod'

export const jiraBaseUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\\\x00-\x1f\x7f]/.test(value) &&
        !url.pathname.split('/').some((part) => /%2f|%5c/i.test(part))
      )
    } catch {
      return false
    }
  }, 'Enter a Jira address without credentials, query or fragment.')
  .transform((value) => {
    const url = new URL(value)
    if (url.hostname.endsWith('.atlassian.net') && /^\/jira\/?$/.test(url.pathname))
      return url.origin
    return url.href.replace(/\/+$/, '')
  })
export const jiraAuthTypeSchema = z.enum(['pat', 'cloud', 'cloud-scoped'])
// Historical snapshot addresses remain readable; credential operations require a secure connection.
export const jiraConnectionUrlSchema = jiraBaseUrlSchema.refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}, 'Use HTTPS for Jira. HTTP is allowed only on this computer.')
export type JiraAuthType = z.infer<typeof jiraAuthTypeSchema>
export function normalizeJiraBaseUrl(value: string, authType: JiraAuthType) {
  const baseUrl = jiraBaseUrlSchema.parse(value)
  return authType === 'pat' ? baseUrl : new URL(baseUrl).origin
}
export const jiraKeySchema = z
  .string()
  .max(100)
  .regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/)
export const jiraConnectionLimit = 20
export const jiraConnectionSchema = z
  .object({
    id: z.union([z.string().uuid(), z.literal('legacy')]),
    name: z.string().trim().max(120).default(''),
    baseUrl: jiraBaseUrlSchema,
    authType: jiraAuthTypeSchema.default('pat'),
  })
  .transform((connection) => ({
    ...connection,
    baseUrl: normalizeJiraBaseUrl(connection.baseUrl, connection.authType),
  }))
export type JiraConnection = z.infer<typeof jiraConnectionSchema>
export const jiraPluginSchema = z
  .object({
    enabled: z.boolean().default(false),
    // Read the original single-server format without touching device credentials.
    baseUrl: z.union([z.literal(''), jiraBaseUrlSchema]).default(''),
    authType: jiraAuthTypeSchema.default('pat'),
    connections: z.array(jiraConnectionSchema).max(jiraConnectionLimit).optional(),
    defaultDisplay: z.enum(['detailed', 'minimal']).default('detailed'),
  })
  .transform((config) => ({
    enabled: config.enabled,
    defaultDisplay: config.defaultDisplay,
    connections:
      config.connections ??
      (config.baseUrl
        ? [
            {
              id: 'legacy' as const,
              name: '',
              baseUrl: normalizeJiraBaseUrl(config.baseUrl, config.authType),
              authType: config.authType,
            },
          ]
        : []),
  }))
  .refine(
    (config) =>
      new Set(config.connections.map((connection) => connection.id)).size ===
        config.connections.length &&
      new Set(config.connections.map((connection) => connection.baseUrl)).size ===
        config.connections.length,
    'Each Jira server must have a unique address and ID.',
  )
  .default(() => ({
    enabled: false,
    connections: [],
    defaultDisplay: 'detailed' as const,
  }))
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(value + 'T00:00:00Z')
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  })
export const jiraIssueAttrsSchema = z
  .strictObject({
    baseUrl: z.union([z.literal(''), jiraBaseUrlSchema]).default(''),
    issueKey: z.union([z.literal(''), jiraKeySchema]).default(''),
    display: z.enum(['detailed', 'minimal']).default('detailed'),
    summary: z.string().max(2000).default(''),
    status: z.string().max(200).default(''),
    statusCategory: z.enum(['', 'new', 'indeterminate', 'done']).default(''),
    dueDate: z.union([z.literal(''), dateSchema]).default(''),
    fetchedAt: z.union([z.literal(''), z.string().datetime()]).default(''),
    // Rejoin only the original sentence fragments when an inline mention becomes a card.
    inlineOrigin: z
      .strictObject({
        type: z.enum(['paragraph', 'heading']),
        before: z.boolean(),
        after: z.boolean(),
        level: z.number().int().min(1).max(4).optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((attrs) => !attrs.issueKey || !!attrs.baseUrl, 'A Jira issue needs its server address')
export type JiraIssueAttrs = z.infer<typeof jiraIssueAttrsSchema>
export type JiraIssue = Omit<JiraIssueAttrs, 'display' | 'inlineOrigin'>
export type JiraCredentialStatus = {
  hasToken: boolean
  encryptionAvailable: boolean
  email?: string
}
export const jiraScopeSchema = z.strictObject({ workspaceId: z.string().uuid() })
export const jiraSelectionSchema = jiraScopeSchema.extend({ baseUrl: jiraBaseUrlSchema.optional() })
export const jiraPatSchema = z
  .string()
  .trim()
  .min(1)
  .max(10000)
  .regex(/^[\x21-\x7e]+$/)
export const jiraEmailSchema = z
  .string()
  .trim()
  .max(320)
  .email()
  .refine((value) => !/[:\s\x00-\x1f\x7f]/.test(value))
export const jiraAuthSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('pat'), pat: jiraPatSchema }),
  z.strictObject({ type: z.literal('cloud'), email: jiraEmailSchema, apiToken: jiraPatSchema }),
  z.strictObject({
    type: z.literal('cloud-scoped'),
    email: jiraEmailSchema,
    apiToken: jiraPatSchema,
  }),
])
export type JiraAuth = z.infer<typeof jiraAuthSchema>
export const jiraCredentialsSchema = jiraScopeSchema.extend({
  baseUrl: jiraConnectionUrlSchema,
  credentials: jiraAuthSchema,
})
export type JiraCredentialsInput = z.infer<typeof jiraCredentialsSchema>
export const jiraRequestSchema = jiraScopeSchema.extend({
  baseUrl: jiraBaseUrlSchema,
  issueKey: jiraKeySchema,
})
export function jiraIssueUrl(baseUrl: string, issueKey: string) {
  return `${jiraBaseUrlSchema.parse(baseUrl)}/browse/${jiraKeySchema.parse(issueKey)}`
}
export function parseJiraKey(input: string, baseUrl: string) {
  const value = input.trim()
  if (!/^https?:\/\//i.test(value)) return jiraKeySchema.parse(value.toUpperCase())
  const url = new URL(value)
  const base = new URL(jiraBaseUrlSchema.parse(baseUrl))
  const prefix = base.pathname.replace(/\/$/, '') + '/browse/'
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(prefix) ||
    url.username ||
    url.password
  )
    throw new Error('Enter an issue key or a link from the configured Jira.')
  return jiraKeySchema.parse(url.pathname.slice(prefix.length).toUpperCase())
}
export function parseJiraResponse(input: unknown, baseUrl: string): JiraIssue {
  const data = z
    .object({
      key: jiraKeySchema,
      fields: z.object({
        summary: z.string().max(2000),
        status: z.object({
          name: z.string().max(200),
          statusCategory: z.object({ key: z.string() }).optional(),
        }),
        duedate: dateSchema.nullish(),
      }),
    })
    .parse(input)
  const category = data.fields.status.statusCategory?.key
  return {
    baseUrl: jiraBaseUrlSchema.parse(baseUrl),
    issueKey: data.key,
    summary: data.fields.summary,
    status: data.fields.status.name,
    statusCategory:
      category === 'new' || category === 'indeterminate' || category === 'done' ? category : '',
    dueDate: data.fields.duedate ?? '',
    fetchedAt: new Date().toISOString(),
  }
}
export function jiraErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )
}
