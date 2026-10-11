import { describe, it, expect } from 'vitest'
import { markdown, safeName, databaseCSV, pageMarkdown } from '../src/shared/export'
import { seedWorkspace } from '../src/shared/seed'
describe('portable exports', () => {
  it('preserves headings, code, tasks, simple tables, and links', () => {
    const w = seedWorkspace()
    const page = w.pages.find((p) => p.title === 'Nmap')!
    const result = pageMarkdown(page, w)
    expect(result).toContain('# Nmap')
    expect(result).toContain('## Host discovery')
    expect(result).toContain('```bash\nnmap -sn')
    expect(result).toContain('| Port | Service |')
    expect(result).toContain('| 443 | HTTPS |')
    const bola = w.pages.find((p) => p.title === 'BOLA')!
    expect(pageMarkdown(bola, w)).toContain('- [x] Map endpoints')
  })
  it('exports inline databases as readable tables with page record links', () => {
    const w = seedWorkspace()
    const database = w.databases[0]
    const page = w.pages.find((p) => p.title === 'Field notes')!
    page.content = {
      type: 'doc',
      content: [{ type: 'databaseEmbed', attrs: { pageId: database.pageId, label: 'Tools' } }],
    }
    const nmap = w.pages.find((p) => p.title === 'Nmap')!
    const result = pageMarkdown(page, w, { [nmap.id]: '../Nmap.md' })
    expect(result).toContain('## Tools')
    expect(result).toContain('| Name | Description |')
    expect(result).toContain('[Nmap](<../Nmap.md>)')
    expect(result).toContain('Discover hosts, ports, and services')
  })
  it('handles code containing backticks without breaking a fence', () => {
    expect(markdown({ type: 'codeBlock', content: [{ type: 'text', text: '```\ninside' }] })).toBe(
      '````\n```\ninside\n````\n\n',
    )
  })
  it('exports relative internal links and local attachment URLs', () => {
    expect(
      markdown(
        { type: 'pageLink', attrs: { pageId: 'one', label: 'Page' } },
        { one: '../Page.md' },
      ),
    ).toBe('[Page](<../Page.md>)\n\n')
    expect(
      markdown(
        { type: 'image', attrs: { src: 'sheco-asset://space/file.png', alt: 'Image' } },
        {},
        '../../attachments/',
      ),
    ).toBe('![Image](../../attachments/file.png)\n\n')
  })
  it('never exports unsafe link schemes or remote image sources', () => {
    const out = markdown({
      type: 'text',
      text: 'Click',
      marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
    })
    expect(out).toBe('Click')
    expect(markdown({ type: 'image', attrs: { src: 'https://tracking.invalid/a.png' } })).toBe('')
  })
  it('escapes CSV quotes, delimiters, and formula injection', () => {
    const w = seedWorkspace()
    const row = w.pages.find((p) => p.title === 'Nmap')!
    row.title = '=HYPERLINK("bad")'
    const description = w.databases[0].columns[0]
    row.properties[description.id] = 'a, b\n"quoted"'
    const csv = databaseCSV(w.databases[0], w)
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
    expect(csv).toContain('"a, b\n""quoted"""')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
  it('generates portable filenames safe on Windows', () => {
    expect(safeName('CON')).toBe('_CON')
    expect(safeName('a/b:c*?. ')).toBe('a-b-c--')
    expect(safeName('')).toBe('Untitled')
  })
})
