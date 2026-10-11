// Curated common options; the complete catalog is editable as data in Settings.
const text = (id: string, label: string, flag: string, placeholder = '', extra = {}) => ({
  id,
  label,
  flag,
  placeholder,
  type: 'text',
  ...extra,
})
const toggle = (id: string, label: string, flag: string, extra = {}) => ({
  id,
  label,
  flag,
  type: 'boolean',
  ...extra,
})
const number = (id: string, label: string, flag: string, placeholder = '', extra = {}) => ({
  id,
  label,
  flag,
  placeholder,
  type: 'number',
  ...extra,
})
const choice = (
  id: string,
  label: string,
  flag: string,
  choices: [string, string][],
  extra = {},
) => ({
  id,
  label,
  flag,
  type: 'choice',
  choices: choices.map(([value, label]) => ({ value, label })),
  ...extra,
})
const argument = (id: string, label: string, placeholder: string, extra = {}) =>
  text(id, label, '', placeholder, { position: 'argument', required: true, ...extra })
// Frozen original definitions let workspace upgrades distinguish defaults from user edits.
export const builtinToolsV1 = [
  {
    id: 'nmap',
    name: 'nmap',
    command: ['nmap'],
    description: 'Network discovery and service inspection',
    documentation: 'https://nmap.org/book/man-briefoptions.html',
    parameters: [
      choice(
        'scan',
        'Scan technique',
        '',
        [
          ['-sS', 'SYN scan'],
          ['-sT', 'TCP connect scan'],
          ['-sU', 'UDP scan'],
          ['-sn', 'Host discovery only'],
        ],
        { group: 'Scan' },
      ),
      text('ports', 'Ports', '-p', '22,80,443 or 1-65535', { group: 'Scan' }),
      toggle('services', 'Detect service versions', '-sV', { group: 'Scan' }),
      toggle('scripts', 'Default scripts', '-sC', { group: 'Scan' }),
      toggle('os', 'Detect operating system', '-O', { group: 'Scan' }),
      toggle('discovery', 'Skip host discovery', '-Pn', { group: 'Scan' }),
      choice(
        'timing',
        'Timing template',
        '-T',
        [
          ['0', '0 · Paranoid'],
          ['1', '1 · Sneaky'],
          ['2', '2 · Polite'],
          ['3', '3 · Normal'],
          ['4', '4 · Aggressive'],
          ['5', '5 · Insane'],
        ],
        { separator: 'joined', group: 'Performance' },
      ),
      number('rate', 'Maximum packet rate', '--max-rate', '100', { group: 'Performance' }),
      text('output', 'Output basename', '-oA', 'results/scan', { group: 'Output' }),
      toggle('open', 'Show open ports only', '--open', { group: 'Output' }),
      toggle('verbose', 'Verbose output', '-v', { group: 'Output' }),
      argument('target', 'Targets', '192.0.2.1', {
        repeatable: true,
        group: 'Target',
        description: 'One host or network per line',
      }),
    ],
  },
  {
    id: 'ffuf',
    name: 'ffuf',
    command: ['ffuf'],
    description: 'HTTP fuzzing with wordlists',
    documentation: 'https://github.com/ffuf/ffuf',
    parameters: [
      text('url', 'Target URL', '-u', 'https://example.com/FUZZ', {
        required: true,
        group: 'Target',
      }),
      text('wordlist', 'Wordlist', '-w', '/path/words.txt', {
        required: true,
        repeatable: true,
        group: 'Target',
      }),
      choice(
        'method',
        'HTTP method',
        '-X',
        [
          ['GET', 'GET'],
          ['POST', 'POST'],
          ['PUT', 'PUT'],
          ['DELETE', 'DELETE'],
          ['HEAD', 'HEAD'],
        ],
        { group: 'Request' },
      ),
      text('headers', 'Headers', '-H', 'Authorization: Bearer …', {
        repeatable: true,
        group: 'Request',
      }),
      text('data', 'Request body', '-d', 'name=FUZZ', { group: 'Request' }),
      text('match', 'Match status codes', '-mc', '200,301,302', { group: 'Filters' }),
      text('filter', 'Exclude status codes', '-fc', '404', { group: 'Filters' }),
      text('size', 'Exclude response sizes', '-fs', '0,42', { group: 'Filters' }),
      toggle('calibrate', 'Automatic calibration', '-ac', { group: 'Filters' }),
      number('threads', 'Threads', '-t', '40', { group: 'Performance' }),
      number('rate', 'Requests per second', '-rate', '10', { group: 'Performance' }),
      text('output', 'Output file', '-o', 'results.json', { group: 'Output' }),
    ],
  },
  {
    id: 'gobuster',
    name: 'gobuster',
    command: ['gobuster', 'dir'],
    description: 'Directory and file discovery · dir mode',
    documentation: 'https://github.com/OJ/gobuster',
    parameters: [
      text('url', 'Target URL', '-u', 'https://example.com', { required: true }),
      text('wordlist', 'Wordlist', '-w', '/path/words.txt', { required: true }),
      text('extensions', 'File extensions', '-x', 'php,html,txt'),
      text('statuses', 'Match status codes', '-s', '200,301,302', {
        exclusiveGroup: 'status-filter',
      }),
      text('exclude', 'Exclude status codes', '-b', '404', { exclusiveGroup: 'status-filter' }),
      text('headers', 'Headers', '-H', 'X-Test: value', { repeatable: true }),
      number('threads', 'Threads', '-t', '10'),
      toggle('length', 'Show response length', '-l'),
      toggle('redirects', 'Follow redirects', '-r'),
      text('output', 'Output file', '-o', 'results.txt'),
    ],
  },
  {
    id: 'hashcat',
    name: 'hashcat',
    command: ['hashcat'],
    description: 'Offline password hash auditing',
    documentation: 'https://hashcat.net/wiki/doku.php?id=hashcat',
    parameters: [
      number('hash', 'Hash type', '-m', '0', {
        required: true,
        description: 'Mode ID from the hashcat documentation',
      }),
      choice(
        'attack',
        'Attack mode',
        '-a',
        [
          ['0', '0 · Wordlist'],
          ['3', '3 · Mask'],
          ['6', '6 · Wordlist + mask'],
          ['7', '7 · Mask + wordlist'],
        ],
        { required: true },
      ),
      text('rules', 'Rules file', '-r', '/path/rules.rule', { repeatable: true }),
      text('session', 'Session name', '--session', 'audit'),
      toggle('status', 'Show status', '--status'),
      text('output', 'Output file', '-o', 'recovered.txt'),
      argument('hashfile', 'Hash file', '/path/hashes.txt'),
      argument('input', 'Wordlist or mask', '/path/words.txt or ?a?a?a?a', { repeatable: true }),
    ],
  },
  {
    id: 'john',
    name: 'John the Ripper',
    command: ['john'],
    description: 'Offline password auditing · John / Jumbo',
    documentation: 'https://www.openwall.com/john/doc/OPTIONS.shtml',
    parameters: [
      text('format', 'Hash format', '--format', 'raw-md5', { separator: 'equals' }),
      text('wordlist', 'Wordlist', '--wordlist', '/path/words.txt', {
        separator: 'equals',
        exclusiveGroup: 'attack',
      }),
      text('incremental', 'Incremental mode', '--incremental', 'ASCII', {
        separator: 'equals',
        exclusiveGroup: 'attack',
      }),
      toggle('rules', 'Enable wordlist rules', '--rules'),
      text('session', 'Session name', '--session', 'audit', { separator: 'equals' }),
      toggle('show', 'Show recovered passwords', '--show'),
      argument('files', 'Hash files', '/path/hashes.txt', { repeatable: true }),
    ],
  },
  {
    id: 'curl',
    name: 'curl',
    command: ['curl'],
    description: 'HTTP requests and data transfer',
    documentation: 'https://curl.se/docs/manpage.html',
    parameters: [
      choice(
        'method',
        'HTTP method',
        '-X',
        [
          ['GET', 'GET'],
          ['POST', 'POST'],
          ['PUT', 'PUT'],
          ['PATCH', 'PATCH'],
          ['DELETE', 'DELETE'],
          ['OPTIONS', 'OPTIONS'],
        ],
        { group: 'Request' },
      ),
      text('headers', 'Headers', '-H', 'Content-Type: application/json', {
        repeatable: true,
        group: 'Request',
      }),
      text('data', 'Request body', '--data', '{"name":"value"}', { group: 'Request' }),
      text('user', 'User and password', '-u', 'user:password', { group: 'Request' }),
      text('proxy', 'Proxy', '-x', 'http://127.0.0.1:8080', { group: 'Request' }),
      toggle('redirects', 'Follow redirects', '-L', { group: 'Request' }),
      number('timeout', 'Maximum time (seconds)', '--max-time', '30', { group: 'Request' }),
      toggle('insecure', 'Skip TLS certificate verification', '-k', { group: 'Request' }),
      toggle('head', 'Headers only', '-I', { group: 'Output' }),
      toggle('verbose', 'Verbose output', '-v', { group: 'Output' }),
      text('output', 'Output file', '-o', 'response.txt', { group: 'Output' }),
      argument('url', 'Target URL', 'https://example.com', { group: 'Target' }),
    ],
  },
  {
    id: 'hydra',
    name: 'hydra',
    command: ['hydra'],
    description: 'Authentication auditing',
    documentation: 'https://github.com/vanhauser-thc/thc-hydra',
    parameters: [
      text('login', 'Login', '-l', 'user', { exclusiveGroup: 'login' }),
      text('logins', 'Login list', '-L', '/path/users.txt', { exclusiveGroup: 'login' }),
      text('password', 'Password', '-p', 'password', { exclusiveGroup: 'password' }),
      text('passwords', 'Password list', '-P', '/path/passwords.txt', {
        exclusiveGroup: 'password',
      }),
      number('port', 'Port', '-s', '22'),
      number('tasks', 'Parallel tasks', '-t', '4'),
      toggle('tls', 'Use TLS', '-S'),
      toggle('stop', 'Stop after the first match', '-f'),
      toggle('verbose', 'Verbose output', '-v'),
      text('output', 'Output file', '-o', 'results.txt'),
      argument('target', 'Service URL', 'ssh://192.0.2.1', {
        description: 'Protocol, host and optional module parameters',
      }),
    ],
  },
  {
    id: 'searchsploit',
    name: 'searchsploit',
    command: ['searchsploit'],
    description: 'Search the local Exploit Database',
    documentation: 'https://www.exploit-db.com/searchsploit',
    parameters: [
      toggle('title', 'Search titles only', '-t'),
      toggle('exact', 'Exact title match', '-e'),
      toggle('case', 'Case-sensitive search', '-c'),
      toggle('strict', 'Strict version matching', '-s'),
      text('exclude', 'Exclude pattern', '--exclude', '(PoC)|/dos/', { separator: 'equals' }),
      text('cve', 'CVE identifier', '--cve', '2021-44228'),
      toggle('json', 'JSON output', '-j'),
      toggle('web', 'Show web links', '-w'),
      argument('terms', 'Search terms', 'apache', {
        repeatable: true,
        required: false,
        description: 'One search term per line',
      }),
    ],
  },
  {
    id: 'socat',
    name: 'socat',
    command: ['socat'],
    description: 'Connect two data streams',
    documentation: 'http://www.dest-unreach.org/socat/doc/socat.html',
    parameters: [
      toggle('debug', 'Diagnostic messages', '-d'),
      toggle('verbose', 'Show transferred data', '-v'),
      toggle('hex', 'Hexadecimal output', '-x'),
      number('timeout', 'Inactivity timeout (seconds)', '-T', '30'),
      number('endwait', 'Wait after EOF (seconds)', '-t', '2'),
      toggle('oneway', 'One-way transfer', '-u'),
      argument('source', 'First address', 'STDIO'),
      argument('destination', 'Second address', 'TCP:192.0.2.1:8080'),
    ],
  },
]

const webWordlists = [
  { value: '/usr/share/wordlists/dirb/common.txt', label: 'DIRB · common' },
  { value: '/usr/share/wordlists/dirb/big.txt', label: 'DIRB · big' },
  {
    value: '/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt',
    label: 'DirBuster · medium',
  },
  { value: '/usr/share/seclists/Discovery/Web-Content/common.txt', label: 'SecLists · common' },
]
const passwordWordlists = [
  { value: '/usr/share/wordlists/rockyou.txt', label: 'RockYou · after unpacking' },
  { value: '/usr/share/wordlists/john.lst', label: 'John · passwords' },
  { value: '/usr/share/wordlists/nmap.lst', label: 'Nmap · passwords' },
]
const wordlistHelp =
  'Kali paths; install the corresponding wordlist package if needed. RockYou requires unpacking rockyou.txt.gz first. You can enter your own path.'
const nmapAdditions = {
  ports: [
    number('top-ports', 'Most common ports', '--top-ports', '100', {
      group: 'Scan',
      exclusiveGroup: 'ports',
      description: 'Scan this many of the most common ports',
    }),
    toggle('fast', 'Fast scan · fewer ports', '-F', { group: 'Scan', exclusiveGroup: 'ports' }),
    text('exclude-ports', 'Exclude ports', '--exclude-ports', '22,80', { group: 'Scan' }),
    toggle('port-order', 'Scan ports in order', '-r', { group: 'Scan' }),
  ],
  services: [
    number('version-intensity', 'Version detection intensity', '--version-intensity', '7', {
      group: 'Scan',
      description: 'Probe intensity from 0 to 9',
    }),
    toggle('comprehensive', 'Comprehensive scan', '-A', {
      group: 'Scan',
      description: 'Enable OS detection, version detection, default scripts and traceroute',
    }),
  ],
  scripts: [
    text('nse', 'NSE scripts', '--script', 'default,vuln or http-*', {
      group: 'Scripts',
      exclusiveGroup: 'scripts',
      description:
        'Choose a category or script, or enter comma-separated names and expressions. This replaces default scripts (-sC).',
      choices: [
        ['default', 'Default scripts'],
        ['safe', 'Safe scripts'],
        ['vuln', 'Vulnerability checks · vuln'],
        ['default,vuln', 'Default + vulnerability checks'],
        ['discovery', 'Discovery scripts'],
        ['auth', 'Authentication scripts'],
        ['http-*', 'HTTP scripts · http-*'],
        ['http-title', 'HTTP page title · http-title'],
        ['ssl-cert', 'TLS certificate · ssl-cert'],
        ['smb-os-discovery', 'SMB OS discovery · smb-os-discovery'],
      ].map(([value, label]) => ({ value, label })),
    }),
    text('script-args', 'Script arguments', '--script-args', 'name=value,name2=value2', {
      group: 'Scripts',
    }),
    text(
      'script-args-file',
      'Script arguments file',
      '--script-args-file',
      '/path/script-args.txt',
      { group: 'Scripts' },
    ),
    toggle('script-trace', 'Trace script traffic', '--script-trace', { group: 'Scripts' }),
  ],
  os: [
    toggle('os-limit', 'Limit OS detection to promising hosts', '--osscan-limit', {
      group: 'Scan',
    }),
    toggle('os-guess', 'Guess operating system', '--osscan-guess', { group: 'Scan' }),
  ],
  discovery: [
    toggle('no-dns', 'Skip DNS resolution', '-n', { group: 'Discovery', exclusiveGroup: 'dns' }),
    toggle('resolve-dns', 'Resolve all targets', '-R', {
      group: 'Discovery',
      exclusiveGroup: 'dns',
    }),
    text('dns-servers', 'DNS servers', '--dns-servers', '192.0.2.53,192.0.2.54', {
      group: 'Discovery',
    }),
    text('syn-ping', 'TCP SYN discovery ports', '-PS', '22,80,443', {
      group: 'Discovery',
      separator: 'joined',
    }),
    text('ack-ping', 'TCP ACK discovery ports', '-PA', '80,443', {
      group: 'Discovery',
      separator: 'joined',
    }),
    text('udp-ping', 'UDP discovery ports', '-PU', '53,161', {
      group: 'Discovery',
      separator: 'joined',
    }),
    toggle('icmp-ping', 'ICMP echo discovery', '-PE', { group: 'Discovery' }),
    toggle('traceroute', 'Trace route to hosts', '--traceroute', { group: 'Discovery' }),
    toggle('ipv6', 'Use IPv6', '-6', { group: 'Target' }),
    text('exclude-hosts', 'Exclude hosts or networks', '--exclude', '192.0.2.2,192.0.2.0/28', {
      group: 'Target',
    }),
    text('exclude-file', 'Excluded hosts file', '--excludefile', '/path/excluded.txt', {
      group: 'Target',
    }),
    text('interface', 'Network interface', '-e', 'eth0', { group: 'Target' }),
  ],
  rate: [
    number('min-rate', 'Minimum packet rate', '--min-rate', '10', { group: 'Performance' }),
    number('retries', 'Maximum probe retries', '--max-retries', '2', { group: 'Performance' }),
    text('host-timeout', 'Host timeout', '--host-timeout', '30m', { group: 'Performance' }),
    text('scan-delay', 'Delay between probes', '--scan-delay', '100ms', { group: 'Performance' }),
    number('min-parallelism', 'Minimum parallel probes', '--min-parallelism', '1', {
      group: 'Performance',
    }),
    number('max-parallelism', 'Maximum parallel probes', '--max-parallelism', '10', {
      group: 'Performance',
    }),
  ],
  output: [
    text('output-normal', 'Text output file', '-oN', 'scan.txt', { group: 'Output' }),
    text('output-xml', 'XML output file', '-oX', 'scan.xml', { group: 'Output' }),
    text('output-grep', 'Grepable output file', '-oG', 'scan.gnmap', { group: 'Output' }),
    toggle('reason', 'Explain host and port states', '--reason', { group: 'Output' }),
    toggle('packet-trace', 'Trace packets', '--packet-trace', { group: 'Output' }),
    toggle('append-output', 'Append to output files', '--append-output', { group: 'Output' }),
  ],
}
export const builtinTools = builtinToolsV1.map((tool) => ({
  ...tool,
  outputPresets:
    tool.id === 'nmap'
      ? [
          {
            id: 'tcp-csv',
            label: 'TCP ports · comma-separated',
            shell: 'posix',
            stages: [
              ['grep', '/tcp'],
              ['cut', '-f1', '-d/'],
              ['paste', '-s', '-d,', '-'],
            ],
          },
          {
            id: 'tcp-lines',
            label: 'TCP ports · one per line',
            shell: 'posix',
            stages: [
              ['grep', '/tcp'],
              ['cut', '-f1', '-d/'],
            ],
          },
          {
            id: 'udp-csv',
            label: 'UDP ports · comma-separated',
            shell: 'posix',
            stages: [
              ['grep', '/udp'],
              ['cut', '-f1', '-d/'],
              ['paste', '-s', '-d,', '-'],
            ],
          },
        ]
      : tool.id === 'curl'
        ? [
            { id: 'json-pretty', label: 'Format JSON · jq', shell: 'any', stages: [['jq', '.']] },
            {
              id: 'json-keys',
              label: 'JSON field names · jq',
              shell: 'any',
              stages: [['jq', '-r', 'keys[]']],
            },
          ]
        : [],
  parameters: tool.parameters.flatMap((p) => {
    if (tool.id === 'nmap') {
      const parameter =
        p.id === 'scan'
          ? {
              ...p,
              choices: [
                ['-sS', 'SYN scan'],
                ['-sT', 'TCP connect scan'],
                ['-sU', 'UDP scan'],
                ['-sn', 'Host discovery only'],
                ['-sA', 'ACK scan'],
                ['-sN', 'NULL scan'],
                ['-sF', 'FIN scan'],
                ['-sX', 'Xmas scan'],
                ['-sO', 'IP protocol scan'],
              ].map(([value, label]) => ({ value, label })),
            }
          : p.id === 'ports'
            ? { ...p, exclusiveGroup: 'ports' }
            : p.id === 'scripts'
              ? { ...p, exclusiveGroup: 'scripts' }
              : p
      return [parameter, ...(nmapAdditions[p.id as keyof typeof nmapAdditions] ?? [])]
    }
    const web = ['ffuf', 'gobuster'].includes(tool.id) && p.id === 'wordlist'
    const passwords =
      (tool.id === 'hashcat' && p.id === 'input') ||
      (tool.id === 'john' && p.id === 'wordlist') ||
      (tool.id === 'hydra' && p.id === 'passwords')
    if (web || passwords)
      return [
        {
          ...p,
          choices: web ? webWordlists : passwordWordlists,
          placeholder: web ? webWordlists[0].value : passwordWordlists[0].value,
          description: web
            ? 'Kali paths; install the corresponding wordlist package if needed. You can enter your own path.'
            : wordlistHelp,
        },
      ]
    return [p]
  }),
}))
