import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWrite } from './storage'
import {
  jiraBaseUrlSchema,
  jiraConnectionUrlSchema,
  jiraAuthSchema,
  jiraAuthTypeSchema,
  normalizeJiraBaseUrl,
  parseJiraResponse,
  type JiraAuth,
  type JiraAuthType,
  type JiraIssue,
} from '../src/shared/jira'

type Encryption = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
const credentialRecordSchema = z.union([
  z.strictObject({ baseUrl: jiraBaseUrlSchema, encryptedPat: z.string().max(30000) }),
  z.strictObject({
    baseUrl: jiraBaseUrlSchema,
    authType: jiraAuthTypeSchema,
    encryptedCredentials: z.string().max(30000),
  }),
])
const credentialsSchema = z.record(
  z.string().uuid(),
  z.union([credentialRecordSchema, z.array(credentialRecordSchema).max(100)]),
)
type CredentialRecord = z.infer<typeof credentialRecordSchema>
function recordsFor(value: z.infer<typeof credentialsSchema>[string] | undefined) {
  return value ? (Array.isArray(value) ? value : [value]) : []
}
function matchingRecord(
  value: z.infer<typeof credentialsSchema>[string] | undefined,
  baseUrl: string,
  authType: JiraAuthType,
) {
  return recordsFor(value).find(
    (record) =>
      record.baseUrl === baseUrl && ('authType' in record ? record.authType : 'pat') === authType,
  )
}
// Local device credentials are deliberately outside workspace snapshots and exports.
export class JiraCredentials {
  private pending: Promise<unknown> = Promise.resolve()
  private file: string
  constructor(
    root: string,
    private encryption: Encryption,
  ) {
    this.file = path.join(root, 'jira-credentials.json')
  }
  private async read() {
    try {
      return credentialsSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new Error('Jira credentials could not be read. Original data is preserved.')
    }
  }
  async status(workspaceId: string, baseUrl: string, authType: JiraAuthType) {
    await this.pending
    const record = matchingRecord((await this.read())[workspaceId], baseUrl, authType)
    const hasToken = !!record
    const credentials =
      hasToken && this.encryption.isEncryptionAvailable() ? this.decrypt(record) : undefined
    return {
      hasToken,
      encryptionAvailable: this.encryption.isEncryptionAvailable(),
      ...(credentials && credentials.type !== 'pat' ? { email: credentials.email } : {}),
    }
  }
  private write(change: (records: z.infer<typeof credentialsSchema>) => void) {
    const operation = this.pending.then(async () => {
      const records = await this.read()
      change(records)
      await atomicWrite(this.file, JSON.stringify(records))
    })
    this.pending = operation.catch(() => {})
    return operation
  }
  save(workspaceId: string, baseUrl: string, credentials: JiraAuth) {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this device.')
    const validated = jiraAuthSchema.parse(credentials)
    const address = jiraConnectionUrlSchema.parse(normalizeJiraBaseUrl(baseUrl, validated.type))
    const encryptedCredentials = this.encryption
      .encryptString(JSON.stringify(validated))
      .toString('base64')
    return this.write((records) => {
      const others = recordsFor(records[workspaceId]).filter((record) => record.baseUrl !== address)
      if (others.length >= 100)
        throw new Error('Remove an unused Jira token before adding another server.')
      records[workspaceId] = [
        ...others,
        {
          baseUrl: address,
          authType: validated.type,
          encryptedCredentials,
        },
      ]
    })
  }
  remove(workspaceId: string, baseUrl?: string) {
    return this.write((records) => {
      if (baseUrl)
        records[workspaceId] = recordsFor(records[workspaceId]).filter(
          (record) => record.baseUrl !== baseUrl,
        )
      else delete records[workspaceId]
    })
  }
  private decrypt(record: CredentialRecord): JiraAuth {
    try {
      if ('encryptedPat' in record)
        return jiraAuthSchema.parse({
          type: 'pat',
          pat: this.encryption.decryptString(Buffer.from(record.encryptedPat, 'base64')),
        })
      const credentials = jiraAuthSchema.parse(
        JSON.parse(
          this.encryption.decryptString(Buffer.from(record.encryptedCredentials, 'base64')),
        ),
      )
      if (credentials.type !== record.authType) throw new Error('Mismatched credential type')
      return credentials
    } catch {
      throw new Error('The Jira token could not be decrypted. Enter it again on this device.')
    }
  }
  async credentials(workspaceId: string, baseUrl: string, authType: JiraAuthType) {
    await this.pending
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable on this device.')
    const record = matchingRecord((await this.read())[workspaceId], baseUrl, authType)
    if (!record) throw new Error('Configure Jira and save a token first.')
    return this.decrypt(record)
  }
}
async function requestJiraJson(
  url: string,
  authorization: string | undefined,
  request: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response | undefined
  try {
    // Never forward credentials through redirects, including tenant discovery.
    response = await request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      redirect: 'manual',
      credentials: 'omit',
      signal,
    })
    if (response.status === 401 || response.status === 403)
      throw new Error(
        'Jira rejected the token or access to this issue. Check credentials and token permissions.',
      )
    if (response.status === 404) throw new Error('Jira issue not found or not accessible.')
    if (response.status >= 300 && response.status < 400)
      throw new Error('Jira redirected the request. Check the server address.')
    if (response.status === 429) throw new Error('Jira request limit reached. Try again later.')
    if (!response.ok) throw new Error('Jira could not return the issue. Try again later.')
    if (!response.body) throw new Error('Jira returned an invalid issue response.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > 1024 * 1024) throw new Error('Jira response exceeds 1 MB.')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new Error('Jira returned an invalid issue response.')
    }
  } catch (error) {
    // Chromium rejects manual redirects before exposing a Response.
    if (
      !response &&
      !signal.aborted &&
      error instanceof Error &&
      error.message === 'Redirect was cancelled'
    )
      throw new Error('Jira redirected the request. Check the server address.')
    if (!response || signal.aborted)
      throw new Error('Could not connect to Jira. Check the address and network.')
    throw error
  } finally {
    await response?.body?.cancel().catch(() => {})
  }
}
export async function fetchJiraIssue(
  baseUrl: string,
  issueKey: string,
  credentials: JiraAuth,
  request: typeof fetch = fetch,
): Promise<JiraIssue> {
  const auth = jiraAuthSchema.parse(credentials)
  const address = jiraConnectionUrlSchema.safeParse(normalizeJiraBaseUrl(baseUrl, auth.type))
  if (!address.success)
    throw new Error('Use HTTPS for Jira. HTTP is allowed only on this computer.')
  const site = address.data
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    let apiBase = site
    if (auth.type === 'cloud-scoped') {
      const url = new URL(site)
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net') || url.port)
        throw new Error('Scoped API tokens require an HTTPS atlassian.net site address.')
      // Discovery has no credentials; only the fixed Atlassian gateway receives the token.
      const tenant = await requestJiraJson(
        `${site}/_edge/tenant_info`,
        undefined,
        request,
        controller.signal,
      )
      const parsed = z.object({ cloudId: z.string().uuid() }).safeParse(tenant)
      if (!parsed.success)
        throw new Error('Could not determine the Jira Cloud ID. Check the site address.')
      apiBase = `https://api.atlassian.com/ex/jira/${parsed.data.cloudId}`
    }
    const authorization =
      auth.type === 'pat'
        ? `Bearer ${auth.pat}`
        : `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`, 'utf8').toString('base64')}`
    const data = await requestJiraJson(
      `${apiBase}/rest/api/${auth.type === 'pat' ? '2' : '3'}/issue/${issueKey}?fields=summary,status,duedate`,
      authorization,
      request,
      controller.signal,
    )
    try {
      return parseJiraResponse(data, site)
    } catch {
      throw new Error('Jira returned an invalid issue response.')
    }
  } finally {
    clearTimeout(timer)
  }
}
