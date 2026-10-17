import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { JiraCredentials, fetchJiraIssue } from '../electron/jira'
import {
  jiraBaseUrlSchema,
  jiraIssueAttrsSchema,
  jiraRequestSchema,
  jiraCredentialsSchema,
  jiraConnectionUrlSchema,
  jiraAuthSchema,
  jiraPluginSchema,
  parseJiraKey,
  parseJiraResponse,
} from '../src/shared/jira'
import { seedWorkspace } from '../src/shared/seed'
import { plainText, searchWorkspace, uid, workspaceSchema } from '../src/shared/model'
import { markdown } from '../src/shared/export'
import { validateEditorDocument } from '../src/editor/documentSchema'

const baseUrl = 'https://jira.example.com/jira'
const payload = {
  key: 'PROJECT-123',
  fields: {
    summary: 'Ship the next release',
    status: { name: 'In progress', statusCategory: { key: 'indeterminate' } },
    duedate: '2026-10-20',
  },
}
const issue = () => parseJiraResponse(payload, baseUrl)
function encryption() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString: (bytes: Buffer) => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}
describe('Jira plugin and document data', () => {
  it('normalizes Cloud navigation URLs and keeps email and API tokens out of workspace data', () => {
    const w = seedWorkspace()
    const cloud = workspaceSchema.parse({
      ...w,
      plugins: {
        ...w.plugins,
        jira: {
          enabled: true,
          baseUrl: 'https://example.atlassian.net/jira/',
          authType: 'cloud',
          email: 'private@example.com',
          apiToken: 'private-api-token',
        },
      },
    })
    expect(cloud.plugins.jira.connections).toEqual([
      { id: 'legacy', name: '', baseUrl: 'https://example.atlassian.net', authType: 'cloud' },
    ])
    expect(JSON.stringify(cloud)).not.toMatch(/private@example|private-api-token/)
    expect(
      parseJiraKey(
        'https://example.atlassian.net/browse/PROJECT-123',
        cloud.plugins.jira.connections[0].baseUrl,
      ),
    ).toBe('PROJECT-123')
    expect(jiraBaseUrlSchema.parse('https://example.atlassian.net/jira/')).toBe(
      'https://example.atlassian.net',
    )
    for (const email of ['invalid', 'with:colon@example.com', 'with\ncontrol@example.com'])
      expect(jiraAuthSchema.safeParse({ type: 'cloud', email, apiToken: 'token' }).success).toBe(
        false,
      )
  })
  it('opens old workspaces without enabling Jira or changing their content', () => {
    const w = seedWorkspace()
    const legacy = JSON.parse(JSON.stringify(w))
    delete legacy.plugins.jira
    const loaded = workspaceSchema.parse(legacy)
    expect(loaded.plugins.jira).toEqual({
      enabled: false,
      connections: [],
      defaultDisplay: 'detailed',
    })
    expect(loaded.pages).toEqual(w.pages)
    const imported = workspaceSchema.parse({
      ...w,
      plugins: { ...w.plugins, jira: { enabled: true, baseUrl, pat: 'do-not-persist' } },
    })
    expect(JSON.stringify(imported)).not.toContain('do-not-persist')
  })
  it('round-trips multiple servers, honors an empty list and rejects ambiguous or oversized lists', () => {
    const connections = [
      { id: uid(), name: 'Work', baseUrl, authType: 'pat' },
      { id: uid(), name: 'Cloud', baseUrl: 'https://other.atlassian.net/jira/', authType: 'cloud' },
    ]
    const parsed = jiraPluginSchema.parse({ enabled: true, connections })
    expect(parsed.connections[1].baseUrl).toBe('https://other.atlassian.net')
    expect(jiraPluginSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
    expect(jiraPluginSchema.parse({ baseUrl, connections: [] }).connections).toEqual([])
    for (const invalid of [
      [connections[0], { ...connections[1], id: connections[0].id }],
      [connections[0], { ...connections[1], baseUrl: baseUrl + '/', authType: 'pat' }],
      Array.from({ length: 21 }, (_, index) => ({
        ...connections[0],
        id: uid(),
        baseUrl: `https://jira${index}.example.com`,
      })),
    ])
      expect(jiraPluginSchema.safeParse({ connections: invalid }).success).toBe(false)
    expect(
      JSON.stringify(
        jiraPluginSchema.parse({ connections: [{ ...connections[0], pat: 'private' }] }),
      ),
    ).not.toContain('private')
  })
  it('normalizes context paths and accepts only issue keys or links from that Jira', () => {
    expect(jiraBaseUrlSchema.parse(' https://jira.example.com/jira/ ')).toBe(baseUrl)
    expect(parseJiraKey('project-123', baseUrl)).toBe('PROJECT-123')
    expect(parseJiraKey(baseUrl + '/browse/PROJECT-123?focusedCommentId=1', baseUrl)).toBe(
      'PROJECT-123',
    )
    for (const url of [
      'file:///etc/passwd',
      'https://user:secret@jira.example.com',
      baseUrl + '?pat=secret',
      baseUrl + '#test',
      baseUrl + '/%2fother',
      'https://jira.example.com\\other',
    ])
      expect(jiraBaseUrlSchema.safeParse(url).success).toBe(false)
    for (const value of [
      'https://other.example.com/jira/browse/PROJECT-123',
      'https://jira.example.com/browse/PROJECT-123',
      baseUrl + '/browse/PROJECT-123/other',
      '../PROJECT-123',
      'PROJECT-1?fields=*',
    ])
      expect(() => parseJiraKey(value, baseUrl)).toThrow()
    expect(
      jiraRequestSchema.safeParse({ workspaceId: uid(), baseUrl, issueKey: '../secret' }).success,
    ).toBe(false)
    expect(
      jiraCredentialsSchema.safeParse({
        workspaceId: uid(),
        baseUrl,
        credentials: { type: 'pat', pat: 'with spaces' },
      }).success,
    ).toBe(false)
  })
  it('validates snapshots through the real editor schema and rejects secret attributes and malformed fields', () => {
    for (const display of ['detailed', 'minimal'])
      expect(() =>
        validateEditorDocument({
          type: 'doc',
          content: [{ type: 'jiraIssue', attrs: { ...issue(), display } }],
        }),
      ).not.toThrow()
    expect(() =>
      validateEditorDocument({ type: 'doc', content: [{ type: 'jiraIssue' }] }),
    ).not.toThrow()
    for (const patch of [
      { display: 'card' },
      { issueKey: 'bad' },
      { dueDate: '2026-02-30' },
      { status: 1 },
      { baseUrl: 'javascript:alert(1)' },
      { pat: 'secret' },
      { fetchedAt: 'yesterday' },
    ])
      expect(() =>
        validateEditorDocument({
          type: 'doc',
          content: [{ type: 'jiraIssue', attrs: { ...issue(), ...patch } }],
        }),
      ).toThrow('Invalid Jira issue attributes')
    expect(jiraIssueAttrsSchema.safeParse({ issueKey: 'PROJECT-1' }).success).toBe(false)
  })
  it('keeps snapshot fields searchable and exports the selected view as a safe issue link', () => {
    const block = { type: 'jiraIssue', attrs: { ...issue(), display: 'detailed' } }
    expect(plainText(block)).toContain('PROJECT-123 Ship the next release In progress 2026-10-20')
    const w = seedWorkspace('Jira', false)
    w.pages[0].content = { type: 'doc', content: [block] }
    expect(searchWorkspace(w, 'PROJECT-123')[0].page.id).toBe(w.pages[0].id)
    expect(searchWorkspace(w, 'Ship the next release')[0].page.id).toBe(w.pages[0].id)
    expect(markdown(block)).toContain(
      '[PROJECT-123](https://jira.example.com/jira/browse/PROJECT-123)',
    )
    expect(markdown(block)).toContain('Status: In progress · Due date: 2026-10-20')
    expect(markdown({ ...block, attrs: { ...block.attrs, display: 'minimal' } }).trim()).toBe(
      '[PROJECT-123](https://jira.example.com/jira/browse/PROJECT-123) (In progress)',
    )
    expect(
      parseJiraResponse({ ...payload, fields: { ...payload.fields, duedate: null } }, baseUrl)
        .dueDate,
    ).toBe('')
  })
})
describe('Jira device credentials', () => {
  it('retains legacy credentials when adding servers and isolates updates, deletion and restart', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-unit-'))
    try {
      const cipher = encryption(),
        id = uid()
      const file = path.join(root, 'jira-credentials.json')
      await fs.writeFile(
        file,
        JSON.stringify({
          [id]: { baseUrl, encryptedPat: cipher.encryptString('old-secret').toString('base64') },
        }),
      )
      const credentials = new JiraCredentials(root, cipher)
      const other = 'https://second.example.com'
      await credentials.save(id, other, {
        type: 'cloud',
        email: 'second@example.com',
        apiToken: 'second-secret',
      })
      expect(await credentials.credentials(id, baseUrl, 'pat')).toEqual({
        type: 'pat',
        pat: 'old-secret',
      })
      await Promise.all([
        credentials.save(id, baseUrl, { type: 'pat', pat: 'updated-secret' }),
        credentials.save(uid(), baseUrl, { type: 'pat', pat: 'unrelated-secret' }),
      ])
      const restarted = new JiraCredentials(root, cipher)
      expect(await restarted.credentials(id, other, 'cloud')).toEqual({
        type: 'cloud',
        email: 'second@example.com',
        apiToken: 'second-secret',
      })
      expect(await restarted.credentials(id, baseUrl, 'pat')).toEqual({
        type: 'pat',
        pat: 'updated-secret',
      })
      await restarted.remove(id, baseUrl)
      expect(await restarted.status(id, baseUrl, 'pat')).toMatchObject({ hasToken: false })
      expect(await restarted.status(id, other, 'cloud')).toMatchObject({ hasToken: true })
      await expect(restarted.credentials(uid(), other, 'cloud')).rejects.toThrow('Configure Jira')
      expect(await fs.readFile(file, 'utf8')).not.toMatch(/secret|second@example/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it('encrypts Cloud email and tokens, scopes them to the selected connection, and reads legacy PAT records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-unit-'))
    try {
      const cipher = encryption()
      const id = uid()
      const file = path.join(root, 'jira-credentials.json')
      const legacy = JSON.stringify({
        [id]: { baseUrl, encryptedPat: cipher.encryptString('legacy-pat').toString('base64') },
      })
      await fs.writeFile(file, legacy)
      const credentials = new JiraCredentials(root, cipher)
      expect(await credentials.credentials(id, baseUrl, 'pat')).toEqual({
        type: 'pat',
        pat: 'legacy-pat',
      })
      expect(await fs.readFile(file, 'utf8')).toBe(legacy)
      const site = 'https://example.atlassian.net'
      const auth = {
        type: 'cloud-scoped' as const,
        email: 'private@example.com',
        apiToken: 'private-api-token',
      }
      await credentials.save(id, site, auth)
      expect(await fs.readFile(file, 'utf8')).not.toMatch(/private@example|private-api-token/)
      const restarted = new JiraCredentials(root, cipher)
      expect(await restarted.credentials(id, site, 'cloud-scoped')).toEqual(auth)
      expect(await restarted.status(id, site, 'cloud-scoped')).toEqual({
        hasToken: true,
        encryptionAvailable: true,
        email: auth.email,
      })
      expect(await restarted.status(id, site, 'cloud')).toMatchObject({ hasToken: false })
      await expect(restarted.credentials(id, site, 'cloud')).rejects.toThrow('Configure Jira')
      await restarted.remove(id)
      expect(await restarted.status(id, site, 'cloud-scoped')).toMatchObject({ hasToken: false })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it('encrypts PATs, survives restart and serializes changes without losing other workspaces', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-unit-'))
    try {
      const cipher = encryption()
      const credentials = new JiraCredentials(root, cipher)
      const first = uid(),
        second = uid()
      await Promise.all([
        credentials.save(first, baseUrl, { type: 'pat', pat: 'secret-first' }),
        credentials.save(second, baseUrl, { type: 'pat', pat: 'secret-second' }),
      ])
      const text = await fs.readFile(path.join(root, 'jira-credentials.json'), 'utf8')
      expect(text).not.toContain('secret-')
      const restarted = new JiraCredentials(root, cipher)
      expect(await restarted.credentials(first, baseUrl, 'pat')).toEqual({
        type: 'pat',
        pat: 'secret-first',
      })
      expect(await restarted.status(first, 'https://other.example.com', 'pat')).toMatchObject({
        hasToken: false,
      })
      await expect(
        restarted.credentials(first, 'https://other.example.com', 'pat'),
      ).rejects.toThrow('Configure Jira')
      await restarted.remove(first)
      await expect(restarted.credentials(first, baseUrl, 'pat')).rejects.toThrow('Configure Jira')
      expect(await restarted.credentials(second, baseUrl, 'pat')).toEqual({
        type: 'pat',
        pat: 'secret-second',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it('preserves damaged credentials and refuses plaintext fallback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-jira-unit-'))
    try {
      const file = path.join(root, 'jira-credentials.json')
      await fs.writeFile(file, 'damaged original')
      const credentials = new JiraCredentials(root, encryption())
      await expect(
        credentials.save(uid(), baseUrl, { type: 'pat', pat: 'secret' }),
      ).rejects.toThrow('Original data is preserved')
      expect(await fs.readFile(file, 'utf8')).toBe('damaged original')
      const unavailable = new JiraCredentials(root, {
        ...encryption(),
        isEncryptionAvailable: () => false,
      })
      expect(() => unavailable.save(uid(), baseUrl, { type: 'pat', pat: 'secret' })).toThrow(
        'Secure credential storage',
      )
      expect(await fs.readFile(file, 'utf8')).toBe('damaged original')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
describe('Jira HTTP boundary', () => {
  it('refuses remote HTTP before any credentials are sent and allows local test connections', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(
      fetchJiraIssue(
        'http://jira.example.com',
        'PROJECT-123',
        { type: 'pat', pat: 'secret' },
        request,
      ),
    ).rejects.toThrow('Use HTTPS')
    expect(request).not.toHaveBeenCalled()
    expect(jiraConnectionUrlSchema.safeParse('http://127.0.0.1:1234/jira').success).toBe(true)
    expect(jiraConnectionUrlSchema.safeParse('http://localhost:1234/jira').success).toBe(true)
    expect(
      jiraCredentialsSchema.safeParse({
        workspaceId: uid(),
        baseUrl: 'http://jira.example.com',
        credentials: { type: 'pat', pat: 'secret' },
      }).success,
    ).toBe(false)
  })
  it('uses Basic email/API token authentication and the root REST v3 URL for Cloud', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    const auth = {
      type: 'cloud' as const,
      email: 'person@example.com',
      apiToken: 'synthetic-api-token',
    }
    const result = await fetchJiraIssue(
      'https://example.atlassian.net/jira/',
      'PROJECT-123',
      auth,
      request,
    )
    expect(result.baseUrl).toBe('https://example.atlassian.net')
    expect(request).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJECT-123?fields=summary,status,duedate',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64')}`,
        },
      }),
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('discovers Cloud ID without credentials and sends scoped tokens only to the fixed Atlassian gateway', async () => {
    const cloudId = uid()
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ cloudId }))
      .mockResolvedValueOnce(Response.json(payload))
    const auth = {
      type: 'cloud-scoped' as const,
      email: 'person@example.com',
      apiToken: 'synthetic-api-token',
    }
    expect(
      await fetchJiraIssue('https://example.atlassian.net/jira/', 'PROJECT-123', auth, request),
    ).toMatchObject({ baseUrl: 'https://example.atlassian.net', issueKey: 'PROJECT-123' })
    expect(request.mock.calls[0]).toEqual([
      'https://example.atlassian.net/_edge/tenant_info',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'manual',
      }),
    ])
    expect(request.mock.calls[1]).toEqual([
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/PROJECT-123?fields=summary,status,duedate`,
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64')}`,
        },
        credentials: 'omit',
        redirect: 'manual',
      }),
    ])
  })
  it('rejects invalid discovery and redirects before sending any Cloud credentials', async () => {
    const auth = {
      type: 'cloud-scoped' as const,
      email: 'person@example.com',
      apiToken: 'synthetic-api-token',
    }
    for (const response of [
      Response.json({ cloudId: '../other' }),
      new Response('', { status: 302 }),
      Response.json({}),
    ]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response)
      await expect(
        fetchJiraIssue('https://example.atlassian.net', 'PROJECT-123', auth, request),
      ).rejects.toThrow(/Cloud ID|redirected/)
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' })
    }
    const request = vi.fn<typeof fetch>()
    await expect(
      fetchJiraIssue('https://not-atlassian.example.com', 'PROJECT-123', auth, request),
    ).rejects.toThrow('atlassian.net')
    expect(request).not.toHaveBeenCalled()
  })
  it('requests only snapshot fields from the configured context with Bearer authentication and no redirects', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    expect(
      await fetchJiraIssue(baseUrl, 'PROJECT-123', { type: 'pat', pat: 'secret' }, request),
    ).toMatchObject({
      issueKey: 'PROJECT-123',
      status: 'In progress',
      dueDate: '2026-10-20',
    })
    expect(request).toHaveBeenCalledWith(
      baseUrl + '/rest/api/2/issue/PROJECT-123?fields=summary,status,duedate',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json', Authorization: 'Bearer secret' },
      }),
    )
  })
  it('reports authentication, missing issues, limits and redirects without exposing response bodies or PATs', async () => {
    for (const [status, message] of [
      [401, 'rejected'],
      [403, 'rejected'],
      [404, 'not found'],
      [302, 'redirected'],
      [429, 'limit'],
      [500, 'could not return'],
    ] as const) {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private server detail secret', { status }))
      await expect(
        fetchJiraIssue(baseUrl, 'PROJECT-123', { type: 'pat', pat: 'secret' }, request),
      ).rejects.toThrow(message)
      expect(request).toHaveBeenCalledTimes(1)
    }
  })
  it('rejects oversized or invalid responses and sanitizes network errors', async () => {
    await expect(
      fetchJiraIssue(
        baseUrl,
        'PROJECT-123',
        { type: 'pat', pat: 'secret' },
        vi.fn<typeof fetch>().mockRejectedValue(new Error('Redirect was cancelled')),
      ),
    ).rejects.toThrow('Jira redirected the request')
    for (const body of [
      'x'.repeat(1024 * 1024 + 1),
      '<html>Login</html>',
      JSON.stringify({ key: 'PROJECT-123', fields: {} }),
    ]) {
      await expect(
        fetchJiraIssue(
          baseUrl,
          'PROJECT-123',
          { type: 'pat', pat: 'secret' },
          vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
        ),
      ).rejects.toThrow(/exceeds|invalid/)
    }
    await expect(
      fetchJiraIssue(
        baseUrl,
        'PROJECT-123',
        { type: 'pat', pat: 'secret' },
        vi.fn<typeof fetch>().mockRejectedValue(new Error('private secret details')),
      ),
    ).rejects.toThrow('Could not connect to Jira')
  })
  it('aborts stalled requests', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const pending = expect(
        fetchJiraIssue(baseUrl, 'PROJECT-123', { type: 'pat', pat: 'secret' }, request),
      ).rejects.toThrow('Could not connect to Jira')
      await vi.advanceTimersByTimeAsync(15000)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })
})
