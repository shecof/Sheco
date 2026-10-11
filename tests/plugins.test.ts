import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { workspaceSchema } from '../src/shared/model'
import { seedWorkspace } from '../src/shared/seed'
import { builtinToolsV1 } from '../src/shared/pluginTools'
import {
  buildCommand,
  commandBuilderTab,
  commandBuilderSettingsTab,
  commandBuilderConfigSchema,
  commandToolSchema,
  pluginsSchema,
  defaultCommandBuilderConfig,
  parsePluginJson,
  quoteArgument,
  type CommandValues,
} from '../src/shared/plugins'

const config = defaultCommandBuilderConfig()
const tool = (id: string) => config.tools.find((tool) => tool.id === id)!
const values = (input: Record<string, string | boolean>): CommandValues =>
  Object.fromEntries(
    Object.entries(input).map(([id, value]) => [
      id,
      { enabled: value !== false, value: typeof value === 'string' ? value : '' },
    ]),
  )
describe('workspace plugins', () => {
  it('upgrades untouched old catalogs once while preserving edits, deletion, ordering and pages', () => {
    const original = seedWorkspace()
    const legacy = JSON.parse(JSON.stringify(original))
    const old = commandBuilderConfigSchema.parse({ ...config, tools: builtinToolsV1 })
    const customNmap = { ...old.tools[0], description: 'Our team setup' }
    const custom = commandToolSchema.parse({
      id: 'team',
      name: 'Team',
      command: ['team'],
      parameters: [],
    })
    legacy.plugins = {
      commandBuilder: {
        enabled: true,
        config: { ...old, tools: [custom, customNmap, old.tools[1]] },
      },
    }
    const next = workspaceSchema.parse(legacy)
    expect(next.pages).toEqual(original.pages)
    expect(next.ui).toEqual(original.ui)
    expect(next.plugins.commandBuilder).toMatchObject({ enabled: true, catalogRevision: 2 })
    expect(next.plugins.commandBuilder.config.tools).toEqual([custom, customNmap, tool('ffuf')])
    // A later imported legacy catalog stays exactly as imported; deleted tools stay deleted.
    next.plugins.commandBuilder.config = old
    expect(workspaceSchema.parse(next).plugins.commandBuilder.config).toEqual(old)
    expect(parsePluginJson(JSON.stringify(old))).toEqual(old)
    expect(parsePluginJson(JSON.stringify(config))).not.toHaveProperty('catalogRevision')
    const upgraded = pluginsSchema.parse({ commandBuilder: { config: old } })
    expect(upgraded.commandBuilder.config).toEqual(config)
    expect(pluginsSchema.parse(upgraded)).toEqual(upgraded)
  })
  it('opens legacy snapshots with disabled defaults and preserves every page', () => {
    const original = seedWorkspace()
    const legacy = JSON.parse(JSON.stringify(original))
    delete legacy.plugins
    const next = workspaceSchema.parse(legacy)
    expect(next.pages).toEqual(original.pages)
    expect(next.ui).toEqual(original.ui)
    expect(next.plugins.commandBuilder.enabled).toBe(false)
    expect(next.plugins.commandBuilder.config.tools.map((t) => t.id)).toEqual([
      'nmap',
      'ffuf',
      'gobuster',
      'hashcat',
      'john',
      'curl',
      'hydra',
      'searchsploit',
      'socat',
    ])
  })
  it('permits plugin tabs only while enabled and retains config after disabling', () => {
    const w = seedWorkspace()
    w.plugins.commandBuilder.enabled = true
    w.ui.tabs.push(commandBuilderTab)
    w.ui.activeId = commandBuilderTab
    expect(workspaceSchema.parse(w).ui.activeId).toBe(commandBuilderTab)
    w.plugins.commandBuilder.enabled = false
    expect(workspaceSchema.safeParse(w).success).toBe(false)
    w.ui.tabs = w.ui.tabs.filter((id) => id !== commandBuilderTab)
    w.ui.activeId = w.ui.tabs[0]
    expect(workspaceSchema.parse(w).plugins.commandBuilder.config).toEqual(config)
    w.ui.tabs.push(commandBuilderSettingsTab)
    w.ui.activeId = commandBuilderSettingsTab
    expect(workspaceSchema.parse(w).ui.activeId).toBe(commandBuilderSettingsTab)
  })
  it('validates portable JSON and rejects unsupported versions, duplicates, executable data and limits', () => {
    expect(parsePluginJson(JSON.stringify(config))).toEqual(config)
    for (const invalid of [
      { ...config, schemaVersion: 2 },
      { ...config, pluginId: 'other' },
      { ...config, tools: [] },
      { ...config, tools: [config.tools[0], config.tools[0]] },
      { ...config, script: 'malicious()' },
      {
        ...config,
        tools: [
          { ...tool('curl'), parameters: [tool('curl').parameters[0], tool('curl').parameters[0]] },
        ],
      },
      { ...config, tools: [{ ...tool('curl'), command: ['curl\0'] }] },
      { ...config, tools: [{ ...tool('curl'), documentation: 'javascript:alert(1)' }] },
    ])
      expect(commandBuilderConfigSchema.safeParse(invalid).success).toBe(false)
    expect(() => parsePluginJson('{bad')).toThrow()
    expect(() => parsePluginJson(' '.repeat(1024 * 1024 + 1))).toThrow('1 MB')
    expect(
      commandToolSchema.safeParse({
        ...tool('curl'),
        parameters: [{ id: 'bad', label: 'bad', type: 'boolean' }],
      }).success,
    ).toBe(false)
    expect(
      commandToolSchema.safeParse({
        ...tool('curl'),
        parameters: [{ id: 'bad', label: 'bad', type: 'choice', choices: [] }],
      }).success,
    ).toBe(false)
  })
})
describe('command assembly', () => {
  it('builds expanded nmap options and quotes arbitrary NSE expressions in both shells', () => {
    const input = values({
      target: '192.0.2.1',
      'top-ports': '100',
      comprehensive: true,
      nse: 'default,vuln',
      'script-args': 'http.useragent=Team audit',
      'syn-ping': '22,443',
    })
    expect(buildCommand(tool('nmap'), input, 'posix')).toEqual({
      command:
        "nmap --top-ports 100 -A --script default,vuln --script-args 'http.useragent=Team audit' -PS22,443 192.0.2.1",
      issues: [],
    })
    expect(
      buildCommand(tool('nmap'), values({ target: '192.0.2.1', nse: 'http-*' }), 'posix').command,
    ).toBe("nmap --script 'http-*' 192.0.2.1")
    expect(
      buildCommand(
        tool('nmap'),
        values({ target: '192.0.2.1', nse: '(default or safe) and not http-*' }),
        'powershell',
      ),
    ).toEqual({
      command: "& nmap --script '(default or safe) and not http-*' 192.0.2.1",
      issues: [],
    })
    const conflicts: Record<string, string | boolean>[] = [
      { ports: '80', 'top-ports': '100' },
      { scripts: true, nse: 'vuln' },
    ]
    for (const conflict of conflicts)
      expect(
        buildCommand(tool('nmap'), values({ target: '192.0.2.1', ...conflict }), 'posix').issues[0]
          .message,
      ).toBe('Conflicting parameters')
  })
  it('adds output pipelines as quoted commands and keeps shell-specific presets separate', () => {
    const ports = buildCommand(
      tool('nmap'),
      values({ target: '192.0.2.1', open: true }),
      'posix',
      'tcp-csv',
    )
    expect(ports).toEqual({
      command: 'nmap --open 192.0.2.1 | grep /tcp | cut -f1 -d/ | paste -s -d, -',
      issues: [],
    })
    if (process.platform !== 'win32') {
      const pipeline = ports.command.slice(ports.command.indexOf(' | ') + 3)
      expect(
        execFileSync('/bin/sh', ['-c', pipeline], {
          input: 'PORT STATE SERVICE\n22/tcp open ssh\n53/udp open domain\n443/tcp open https\n',
          encoding: 'utf8',
        }).trim(),
      ).toBe('22,443')
    }
    expect(
      buildCommand(tool('nmap'), values({ target: '192.0.2.1' }), 'powershell', 'tcp-csv').issues[0]
        .message,
    ).toBe('Output preset is unavailable for this shell')
    const custom = commandToolSchema.parse({
      ...tool('curl'),
      outputPresets: [
        {
          id: 'custom',
          label: 'Custom',
          shell: 'any',
          stages: [['formatter', '$(touch secret); | grep x', "a'b"]],
        },
      ],
    })
    expect(
      buildCommand(custom, values({ url: 'https://example.com' }), 'powershell', 'custom').command,
    ).toBe("& curl.exe https://example.com | & formatter '$(touch secret); | grep x' 'a''b'")
    expect(
      buildCommand(tool('curl'), values({ url: 'https://example.com' }), 'posix', 'json-pretty')
        .command,
    ).toBe('curl https://example.com | jq .')
    expect(parsePluginJson(JSON.stringify(config)).tools[0].outputPresets).toEqual(
      tool('nmap').outputPresets,
    )
    for (const outputPresets of [
      [{ id: 'bad', label: 'Bad', stages: [] }],
      [{ id: 'bad', label: 'Bad', stages: [['grep\nmalformed']] }],
      [{ id: 'bad', label: 'Bad', stages: [['grep']], execute: true }],
      [tool('nmap').outputPresets[0], tool('nmap').outputPresets[0]],
    ])
      expect(commandToolSchema.safeParse({ ...tool('nmap'), outputPresets }).success).toBe(false)
  })
  it('offers portable wordlist suggestions without restricting custom paths or repeated values', () => {
    const portable = parsePluginJson(JSON.stringify(config))
    for (const [id, parameter] of [
      ['ffuf', 'wordlist'],
      ['gobuster', 'wordlist'],
      ['john', 'wordlist'],
      ['hashcat', 'input'],
      ['hydra', 'passwords'],
    ]) {
      expect(
        portable.tools.find((t) => t.id === id)!.parameters.find((p) => p.id === parameter)!.choices
          .length,
      ).toBeGreaterThan(0)
    }
    expect(
      buildCommand(
        tool('ffuf'),
        values({
          url: 'https://example.com/FUZZ',
          wordlist: '/usr/share/wordlists/dirb/common.txt\n/my custom/list.txt',
        }),
        'posix',
      ),
    ).toEqual({
      command:
        "ffuf -u https://example.com/FUZZ -w /usr/share/wordlists/dirb/common.txt -w '/my custom/list.txt'",
      issues: [],
    })
  })
  it('orders named options before positional inputs and supports joined and equals forms', () => {
    expect(
      buildCommand(
        tool('nmap'),
        values({ target: '192.0.2.1\n192.0.2.2', services: true, ports: '80,443', timing: '3' }),
        'posix',
      ),
    ).toEqual({ command: 'nmap -p 80,443 -sV -T3 192.0.2.1 192.0.2.2', issues: [] })
    expect(
      buildCommand(
        tool('john'),
        values({ files: '/path/hash file.txt', wordlist: '/path/word list.txt', rules: true }),
        'posix',
      ),
    ).toEqual({
      command: `john '--wordlist=/path/word list.txt' --rules '/path/hash file.txt'`,
      issues: [],
    })
    expect(
      buildCommand(
        tool('gobuster'),
        values({ url: 'https://example.com', wordlist: 'words.txt' }),
        'posix',
      ).command,
    ).toBe('gobuster dir -u https://example.com -w words.txt')
  })
  it('repeats flags for values and preserves spaces, quotes, metacharacters and JSON', () => {
    const result = buildCommand(
      tool('curl'),
      values({
        url: 'https://example.com?q=one&b=two',
        headers: 'X-First: a b\nX-Second: value',
        data: '{"name":"a\'b", "raw":"$(printf injected)"}',
      }),
      'posix',
    )
    expect(result.issues).toEqual([])
    expect(result.command.match(/-H /g)).toHaveLength(2)
    const strings = [
      "a'b",
      'a b',
      '$(printf injected)',
      '`printf injected`',
      'a; echo injected',
      'https://example.com?a=1&b=2',
      '*.txt',
      '',
      '~/.cache',
      '@args',
      'a,b',
    ]
    if (process.platform !== 'win32') {
      for (const value of strings)
        expect(
          execFileSync('/bin/sh', ['-c', `printf '%s' ${quoteArgument(value, 'posix')}`], {
            encoding: 'utf8',
          }),
        ).toBe(value)
    }
    expect(quoteArgument("a'b $args", 'powershell')).toBe("'a''b $args'")
    expect(quoteArgument('@args', 'powershell')).toBe("'@args'")
    expect(
      buildCommand(tool('curl'), values({ url: 'https://example.com' }), 'powershell').command,
    ).toBe('& curl.exe https://example.com')
  })
  it('rejects missing, invalid and conflicting values before copy', () => {
    expect(buildCommand(tool('nmap'), {}, 'posix').issues[0].id).toBe('target')
    expect(
      buildCommand(tool('nmap'), values({ target: '', timing: '99' }), 'posix').issues.map(
        (e) => e.id,
      ),
    ).toEqual(['timing', 'target'])
    expect(
      buildCommand(
        tool('ffuf'),
        values({ url: 'https://example.com/FUZZ', wordlist: 'words.txt', threads: 'NaN' }),
        'posix',
      ).issues[0].message,
    ).toBe('Enter a number')
    expect(
      buildCommand(
        tool('hydra'),
        values({ target: 'ssh://192.0.2.1', login: 'user', logins: 'users.txt' }),
        'posix',
      ).issues[0].message,
    ).toBe('Conflicting parameters')
    expect(
      buildCommand(tool('curl'), values({ url: 'https://example.com\nmalformed' }), 'posix')
        .issues[0].message,
    ).toBe('Control characters are not allowed')
  })
  it('builds the remaining catalog entries and accepts custom tools', () => {
    const cases: Record<string, Record<string, string | boolean>> = {
      ffuf: { url: 'https://example.com/FUZZ', wordlist: 'words.txt', calibrate: true },
      hashcat: { hash: '0', attack: '0', hashfile: 'hashes.txt', input: 'words.txt' },
      hydra: { login: 'user', passwords: 'passwords.txt', target: 'ssh://192.0.2.1' },
      searchsploit: { terms: 'apache\n2.4', title: true },
      socat: { source: 'STDIO', destination: 'TCP:192.0.2.1:8080', debug: true },
    }
    for (const [id, input] of Object.entries(cases))
      expect(buildCommand(tool(id), values(input), 'posix').issues).toEqual([])
    const custom = commandToolSchema.parse({
      id: 'custom',
      name: 'Custom',
      command: ['custom', 'inspect'],
      parameters: [
        { id: 'output', label: 'Output', flag: '--output' },
        { id: 'target', label: 'Target', position: 'argument', required: true },
      ],
    })
    expect(
      buildCommand(custom, values({ output: 'a b.txt', target: '192.0.2.1' }), 'posix'),
    ).toEqual({ command: "custom inspect --output 'a b.txt' 192.0.2.1", issues: [] })
  })
})
