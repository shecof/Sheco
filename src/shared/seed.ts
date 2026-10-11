import { type Workspace, type DocNode, type Column, createPage, uid } from './model'
import { defaultPlugins } from './plugins'
const text = (value: string): DocNode => ({ type: 'text', text: value })
const p = (value: string): DocNode => ({ type: 'paragraph', content: [text(value)] })
const h = (value: string, level = 2): DocNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})
const code = (value: string, language = 'bash'): DocNode => ({
  type: 'codeBlock',
  attrs: { language },
  content: [text(value)],
})
export function seedWorkspace(name = 'Knowledge', demo = true): Workspace {
  const now = new Date().toISOString()
  const w: Workspace = {
    schemaVersion: 1,
    id: uid(),
    name,
    icon: '◈',
    revision: 0,
    pages: [],
    databases: [],
    attachments: [],
    plugins: defaultPlugins(),
    ui: {
      tabs: [],
      activeId: null,
      expanded: [],
      favorites: [],
      theme: 'light',
      accent: 'neutral',
      showOutline: true,
      fixedWidth: true,
      fontSize: 0,
      sidebarWidth: 252,
    },
    createdAt: now,
    updatedAt: now,
  }
  if (!demo) {
    const page = createPage(w, 'Welcome to ' + name)
    page.content = {
      type: 'doc',
      content: [
        p('A fresh space for your ideas. Start writing, or type / to add a block.'),
        {
          type: 'callout',
          attrs: { emoji: '✦' },
          content: [
            p(
              'Everything you write stays on this device. No account, no cloud, just your knowledge.',
            ),
          ],
        },
      ],
    }
    w.pages.push(page)
    w.ui.tabs = [page.id]
    w.ui.activeId = page.id
    return w
  }
  const add = (
    title: string,
    icon: string,
    parentId: string | null = null,
    content: DocNode[] = [],
  ) => {
    const page = createPage(w, title, parentId)
    page.icon = icon
    if (content.length) page.content = { type: 'doc', content }
    w.pages.push(page)
    return page
  }
  const welcome = add('Getting started', 'sparkles', null, [
    h('Your knowledge, at home.', 1),
    p(
      'Sheco brings your notes, ideas, and resources together in a private space. Everything is saved locally, and you can take it with you.',
    ),
    {
      type: 'callout',
      attrs: { emoji: '🌱' },
      content: [
        p(
          'This is a sample workspace. Make it your own, or create an empty space from the workspace menu.',
        ),
      ],
    },
    h('Make yourself at home'),
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [p('Create your first page using the + button in the sidebar.')],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [p('Type / in a note to discover all available blocks.')],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [p('Use ⌘K / Ctrl+K to find anything in your space.')],
        },
      ],
    },
    h('A connected way to think'),
    p(
      'Type [[ to link a page. Related notes will appear in the backlinks section. Database entries are full pages too — open a row to add notes.',
    ),
    h('Your data belongs to you'),
    p(
      'Choose a workspace folder in Settings. Export your pages as Markdown, your database as CSV, or your entire space as a portable folder. PDF export follows the page layout.',
    ),
  ])
  const vulnerabilities = add('Vulnerabilities', 'shield')
  const bola = add('BOLA', 'file', vulnerabilities.id, [
    {
      type: 'callout',
      attrs: { emoji: '🔐' },
      content: [
        p(
          'Broken Object Level Authorization is an access control failure. Always test only systems you are authorized to assess.',
        ),
      ],
    },
    h('Overview'),
    p(
      'Object identifiers are not authorization. The server must verify that the current user can access each requested object.',
    ),
    h('What to look for'),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [p('Endpoints that accept a user, document, or resource ID.')],
        },
        {
          type: 'listItem',
          content: [p('Responses that expose data belonging to another account.')],
        },
        {
          type: 'listItem',
          content: [p('Inconsistent checks between read, update, and delete actions.')],
        },
      ],
    },
    h('Example request'),
    code(
      'GET /api/documents/42 HTTP/1.1\nHost: example.test\nAuthorization: Bearer <your-test-token>',
      'http',
    ),
    h('Mitigation'),
    p(
      'Enforce object-level authorization for every operation. Test with two controlled accounts and confirm that cross-account access is denied.',
    ),
    {
      type: 'blockquote',
      content: [
        p(
          'Random identifiers help reduce enumeration, but they do not replace an authorization check.',
        ),
      ],
    },
    h('Testing checklist'),
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [p('Map endpoints and object ownership.')],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [p('Verify authorization with two test accounts.')],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [p('Document evidence and remediation.')],
        },
      ],
    },
  ])
  add('SQL Injection', 'file', vulnerabilities.id, [
    h('SQL Injection'),
    p('Use parameterized queries and test authorization boundaries in a controlled environment.'),
  ])
  add('Cross-site scripting', 'file', vulnerabilities.id, [
    h('Cross-site scripting'),
    p(
      'Apply contextual output encoding, validate inputs, and use a restrictive content security policy.',
    ),
  ])
  const resources = add('Resources', 'folder')
  const tools = createPage(w, 'Tools', resources.id, 'database')
  tools.icon = 'wrench'
  tools.description = 'A curated toolkit for research, testing, and exploration.'
  w.pages.push(tools)
  const columns: Column[] = [
    { id: uid(), name: 'Description', type: 'text', width: 260, hidden: false, options: [] },
    {
      id: uid(),
      name: 'Type',
      type: 'select',
      width: 130,
      hidden: false,
      options: ['Website', 'Utility', 'Python utility'],
    },
    {
      id: uid(),
      name: 'Category',
      type: 'multiSelect',
      width: 180,
      hidden: false,
      options: [
        'JWT',
        'Web',
        'Proxy',
        'HTTP',
        'Network',
        'Recon',
        'DNS',
        'SQL',
        'Fuzzing',
        'REST',
        'Dictionary',
      ],
    },
    { id: uid(), name: 'Link', type: 'url', width: 210, hidden: false, options: [] },
  ]
  const db = {
    id: uid(),
    pageId: tools.id,
    columns,
    titleWidth: 220,
    view: 'table' as const,
    sort: null,
    filters: [],
  }
  w.databases.push(db)
  const entries: [string, string, string, string[], string][] = [
    ['jwt.io', 'Decode and inspect JSON Web Tokens.', 'Website', ['JWT'], 'https://jwt.io'],
    [
      'Burp Suite',
      'Intercept, inspect, and modify HTTP traffic.',
      'Utility',
      ['Web', 'Proxy', 'HTTP'],
      'https://portswigger.net/burp',
    ],
    [
      'Nmap',
      'Discover hosts, ports, and services on a network.',
      'Utility',
      ['Network', 'Recon'],
      'https://nmap.org',
    ],
    [
      'ffuf',
      'Fast web fuzzing for discovery and testing.',
      'Utility',
      ['Fuzzing', 'REST'],
      'https://github.com/ffuf/ffuf',
    ],
    [
      'sqlmap',
      'Automate SQL injection detection in authorized tests.',
      'Utility',
      ['SQL'],
      'https://sqlmap.org',
    ],
    [
      'jwt_tool',
      'Inspect and test JWT implementations.',
      'Python utility',
      ['JWT'],
      'https://github.com/ticarpi/jwt_tool',
    ],
    [
      'Wireshark',
      'Understand what is happening on your network.',
      'Utility',
      ['Network'],
      'https://www.wireshark.org',
    ],
    ['dig', 'Query DNS records from the command line.', 'Utility', ['DNS'], ''],
    [
      'dnsrecon',
      'Gather and inspect DNS information.',
      'Python utility',
      ['DNS', 'Recon'],
      'https://github.com/darkoperator/dnsrecon',
    ],
    [
      'CyberChef',
      'A workbench for encoding and decoding data.',
      'Website',
      ['Web'],
      'https://gchq.github.io/CyberChef/',
    ],
  ]
  let nmapId = ''
  for (const [title, description, type, categories, link] of entries) {
    const page = createPage(w, title, tools.id, 'page', db.id)
    page.properties = {
      [columns[0].id]: description,
      [columns[1].id]: type,
      [columns[2].id]: categories,
      [columns[3].id]: link,
    }
    page.content = {
      type: 'doc',
      content:
        title === 'Nmap'
          ? [
              p('A field guide for network discovery in an authorized environment.'),
              h('Host discovery'),
              p('Find responding hosts without scanning ports.'),
              code('nmap -sn 192.0.2.0/24'),
              h('Service discovery'),
              code('nmap -sV 192.0.2.10'),
              h('Useful ports'),
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    content: [
                      { type: 'tableHeader', content: [p('Port')] },
                      { type: 'tableHeader', content: [p('Service')] },
                    ],
                  },
                  {
                    type: 'tableRow',
                    content: [
                      { type: 'tableCell', content: [p('22')] },
                      { type: 'tableCell', content: [p('SSH')] },
                    ],
                  },
                  {
                    type: 'tableRow',
                    content: [
                      { type: 'tableCell', content: [p('443')] },
                      { type: 'tableCell', content: [p('HTTPS')] },
                    ],
                  },
                ],
              },
            ]
          : [p(description), h('Notes'), p('Add your workflows, examples, and findings here.')],
    }
    if (title === 'Nmap') nmapId = page.id
    w.pages.push(page)
  }
  resources.content = {
    type: 'doc',
    content: [
      p('Tools and references I return to.'),
      { type: 'pageLink', attrs: { pageId: tools.id, label: 'Tools' } },
    ],
  }
  add('Field notes', 'notebook', null, [
    h('Small observations, useful connections'),
    p('Use this page as a scratchpad. Capture something now and organize it later.'),
    p('A useful starting point: '),
    { type: 'pageLink', attrs: { pageId: nmapId, label: 'Nmap' } },
  ])
  add('Projects', 'layers')
  add('Learning', 'graduation')
  w.ui = {
    ...w.ui,
    tabs: [tools.id, bola.id],
    activeId: tools.id,
    expanded: [vulnerabilities.id, resources.id],
    favorites: [welcome.id, tools.id],
    theme: 'light',
  }
  return w
}
