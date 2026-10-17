import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'
import sharp from 'sharp'

const output = path.resolve('test-results/architecture-crossings')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-crossings-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
await build({
  stdin: {
    contents:
      "export * from './src/shared/projectArchitecture'; export { architectureRouteBridges } from './src/shared/architectureRouting'; export { seedWorkspace } from './src/shared/seed'; export {createPage, workspaceSchema} from './src/shared/model'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'model.mjs'),
})
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const translate = (key) => (key === 'No objects yet.' ? '' : key)
const w = api.seedWorkspace('Crossing rendering review', false)
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
const cases = [
  {
    name: 'Near arrowheads',
    routes: [
      [
        [40, 90],
        [340, 90],
      ],
      [
        [330, 45],
        [330, 125],
      ],
      [
        [340, 170],
        [40, 170],
      ],
      [
        [50, 130],
        [50, 230],
      ],
    ],
  },
  {
    name: 'Close parallel lines',
    routes: [
      [
        [40, 100],
        [340, 100],
      ],
      [
        [40, 104],
        [340, 104],
      ],
      [
        [160, 55],
        [160, 210],
      ],
      [
        [168, 55],
        [168, 210],
      ],
    ],
  },
  {
    name: 'Colored background',
    routes: [
      [
        [40, 100],
        [340, 100],
      ],
      [
        [190, 50],
        [190, 230],
      ],
    ],
  },
].map((sample) => {
  const project = api.createArchitectureProject(sample.name)
  project.presentation = { showTitle: false, showResources: false, showBalances: false }
  project.sites = [{ id: id(), name: sample.name, background: 'purple' }]
  const routes = sample.routes.map((points) => points.map(([x, y]) => ({ x, y })))
  project.objects = routes.flatMap((_points, edge) =>
    [0, 1].map((end) => ({
      id: id(),
      name: `Object ${edge}.${end}`,
      type: 'server',
      os: '',
      resources: {},
      parameters: [],
    })),
  )
  project.links = routes.map((_points, edge) => ({
    id: id(),
    from: project.objects[edge * 2].id,
    to: project.objects[edge * 2 + 1].id,
    label: '',
    startArrow: 'arrow',
    endArrow: 'arrow',
  }))
  api.architectureProjectSchema.parse(project)
  const geometry = api.architectureRouteBridges(routes)
  const layout = {
    x: 0,
    y: 0,
    width: 400,
    height: 260,
    sites: [{ ...project.sites[0], x: 1, y: 1, width: 398, height: 258 }],
    groups: [],
    nodes: [],
    edges: routes.map((points, edge) => ({
      points,
      link: project.links[edge],
      label: null,
      ...geometry[edge],
    })),
  }
  return { ...sample, project, layout, geometry }
})
expect(cases[0].geometry.every((edge) => !edge.bridges.length)).toBe(true)
expect(cases[1].geometry[0].bridges).toHaveLength(2)
expect(cases[1].geometry[1].bridges).toHaveLength(2)
expect(cases[2].geometry[0].bridges).toHaveLength(1)
for (const sample of cases)
  await fs.writeFile(
    path.join(output, sample.name + '.svg'),
    api.architectureSvg(sample.project, undefined, translate, false, undefined, sample.layout),
  )
const native = api.createArchitectureProject('Native crossing interaction')
native.presentation = { showTitle: false, showResources: false, showBalances: false }
native.objects = [
  [0, 0],
  [1200, 0],
  [400, -400],
  [400, 400],
].map(([x, y], index) => ({
  id: id(),
  name: `Node ${index}`,
  type: 'server',
  position: { x, y },
  os: '',
  resources: {},
  parameters: [],
}))
native.links = [0, 2].map((index) => ({
  id: id(),
  from: native.objects[index].id,
  to: native.objects[index + 1].id,
  label: '',
}))
const owner = api.createPage(w, native.name, null, 'architecture')
owner.architecture = native
w.plugins.projectArchitecture.enabled = true
w.pages.push(owner)
w.ui.activeId = owner.id
w.ui.tabs = [owner.id]
api.workspaceSchema.parse(w)
await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify(w))
let app
const observed = []
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  const page = await app.firstWindow()
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 700))
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const canvas = page.locator('.architecture-diagram:visible')
  const bridge = canvas.locator('[data-architecture-link-bridge]').first()
  await expect(bridge).toBeVisible()
  const bridgeId = await bridge.getAttribute('data-architecture-link-bridge')
  const midpoint = await bridge
    .locator('.architecture-link-line')
    .first()
    .evaluate((node) => {
      const point = node
        .getPointAtLength(node.getTotalLength() / 2)
        .matrixTransform(node.getScreenCTM())
      return { x: point.x, y: point.y }
    })
  await page.mouse.click(midpoint.x, midpoint.y)
  await expect(canvas.locator('.architecture-endpoint-handle').first()).toHaveAttribute(
    'data-architecture-link',
    bridgeId,
  )
  await page.keyboard.press('Delete')
  await expect(canvas.locator(`[data-architecture-link="${bridgeId}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo architecture change', exact: true }).click()
  await expect(canvas.locator(`[data-architecture-link="${bridgeId}"]`)).toHaveCount(1)
  await expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      ({ theme, markup }) => {
        document.querySelector('#crossing-review')?.remove()
        document.documentElement.dataset.theme = theme
        const mount = document.createElement('div')
        mount.id = 'crossing-review'
        mount.className = 'architecture-diagram'
        mount.style.cssText =
          'position:fixed;inset:0;z-index:100000;background:var(--canvas);display:flex;gap:20px;padding:24px;align-items:start'
        mount.innerHTML = markup
        mount.querySelectorAll('svg').forEach((svg) => {
          svg.style.width = '400px'
          svg.style.height = '260px'
          svg.style.flex = '0 0 400px'
        })
        document.body.append(mount)
      },
      {
        theme,
        markup: cases
          .map((sample) =>
            api.architectureSvg(
              sample.project,
              undefined,
              translate,
              true,
              undefined,
              sample.layout,
            ),
          )
          .join(''),
      },
    )
    const svgs = page.locator('#crossing-review > svg')
    for (const selected of [false, true]) {
      await page.locator('#crossing-review').evaluate((mount, active) => {
        mount
          .querySelectorAll('[data-architecture-link],[data-architecture-link-bridge]')
          .forEach((node) => node.classList.toggle('selected', active))
      }, selected)
      const appearance = theme + (selected ? '-selected' : '')
      for (let index = 0; index < cases.length; index++) {
        const svg = svgs.nth(index)
        const sample = cases[index]
        const frame = await svg.evaluate((node) => {
          const matrix = node.getScreenCTM(),
            box = node.getBoundingClientRect()
          return {
            a: matrix.a,
            b: matrix.b,
            c: matrix.c,
            d: matrix.d,
            e: matrix.e - box.x,
            f: matrix.f - box.y,
            width: box.width,
            height: box.height,
            line: getComputedStyle(
              node.querySelector('[data-architecture-link] .architecture-link-line'),
            )
              .stroke.match(/[\d.]+/g)
              .map(Number)
              .slice(0, 3),
            marker: getComputedStyle(node.querySelector('marker path'))
              .fill.match(/[\d.]+/g)
              .map(Number)
              .slice(0, 3),
          }
        })
        // Gaps must never become marker endpoints: marker geometry is one continuous route.
        const markers = await svg.locator('.architecture-link-arrowheads').evaluateAll((nodes) =>
          nodes.map((node) => ({
            moves: (node.getAttribute('d').match(/M /g) ?? []).length,
            start: node.hasAttribute('marker-start'),
            end: node.hasAttribute('marker-end'),
          })),
        )
        expect(markers).toHaveLength(sample.project.links.length)
        expect(markers.every((marker) => marker.moves === 1 && marker.start && marker.end)).toBe(
          true,
        )
        const buffer = await svg.screenshot({
          path: path.join(output, `${index + 1}-${appearance}.png`),
        })
        const { data, info } = await sharp(buffer)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const pixel = (x, y) => {
          const screenX = frame.a * x + frame.c * y + frame.e
          const screenY = frame.b * x + frame.d * y + frame.f
          const offset =
            (Math.floor((screenY / frame.height) * info.height) * info.width +
              Math.floor((screenX / frame.width) * info.width)) *
            info.channels
          return [...data.subarray(offset, offset + 3)]
        }
        if (index === 2) {
          const background = pixel(240, 80),
            nearCurve = pixel(192, 93)
          expect(nearCurve).toEqual(background)
          expect(pixel(190, 93.25)).toEqual(frame.line)
          expect(pixel(190, 96.75)).toEqual(frame.line)
          expect(pixel(337, 100)).toEqual(frame.marker)
          observed.push({ theme, selected, background, nearCurve, marker: pixel(337, 100) })
        }
      }
      await page
        .locator('#crossing-review')
        .screenshot({ path: path.join(output, `overview-${appearance}.png`) })
    }
  }
  expect(errors).toEqual([])
  await fs.writeFile(
    path.join(output, 'verification.json'),
    JSON.stringify({ status: 'passed', observed, errors }, null, 2),
  )
  console.log('Architecture crossings review passed:', output)
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => {})
    await app.close().catch(() => {})
  }
}
