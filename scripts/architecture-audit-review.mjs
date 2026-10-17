import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as id } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const output = path.resolve('test-results/architecture-audit-fixes')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sheco-architecture-audit-'))
const workspace = path.join(root, 'Knowledge')
await fs.mkdir(workspace)
await fs.mkdir(output, { recursive: true })
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/shared/projectArchitecture'; export * from './src/shared/architecturePlacement'; export { seedWorkspace } from './src/shared/seed'; export { workspaceSchema } from './src/shared/model'; export { projectArchitectureTab } from './src/shared/plugins'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
await fs.writeFile(path.join(root, 'model.mjs'), bundle.outputFiles[0].contents)
const api = await import(pathToFileURL(path.join(root, 'model.mjs')).href)
const geom = (p, route = false) => api.architectureDiagramLayout(p, undefined, undefined, route)
const overlap = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const node = (name, siteId, position, groupId, type = 'server') => ({
  id: id(),
  name,
  type,
  ...(siteId && { siteId }),
  ...(groupId && { groupId }),
  position,
  os: 'Debian',
  resources: { cpu: 4, ram: 8 },
  disks: [{ id: id(), name: 'System', resourceId: 'nvme', capacity: 20 }],
  parameters: [],
})
const project = (name) => {
  const p = api.createArchitectureProject(name)
  p.presentation = { showTitle: false, showResources: true, showBalances: false }
  p.resources.forEach((r) => (r.capacity = 10000))
  return p
}
const duplicate = project('Duplicate growth')
duplicate.sites = [
  { id: id(), name: 'Moscow', position: { x: 32, y: 96 }, background: 'blue' },
  { id: id(), name: 'Novosibirsk', position: { x: 448, y: 96 }, background: 'purple' },
]
duplicate.objects = [
  node('api-01', duplicate.sites[0].id, { x: 32, y: 64 }),
  node('api-02', duplicate.sites[0].id, { x: 32, y: 240 }),
  node('orders-db', duplicate.sites[1].id, { x: 32, y: 64 }, undefined, 'database'),
]
const membership = project('Group membership')
membership.sites = [{ id: id(), name: 'Moscow', position: { x: 32, y: 96 }, background: 'blue' }]
membership.groups = [
  {
    id: id(),
    name: 'API servers',
    siteId: membership.sites[0].id,
    position: { x: 16, y: 256 },
    background: 'green',
  },
]
membership.objects = [
  node('store.example', membership.sites[0].id, { x: 32, y: 64 }, undefined, 'website'),
  node('api-01', membership.sites[0].id, { x: 16, y: 48 }, membership.groups[0].id),
  node('api-02', membership.sites[0].id, { x: 16, y: 224 }, membership.groups[0].id),
]
const swap = project('Unequal site swap')
swap.sites = [
  { id: id(), name: 'Wide site', position: { x: 32, y: 96 }, background: 'blue' },
  { id: id(), name: 'Small site', position: { x: 768, y: 96 }, background: 'green' },
  { id: id(), name: 'Third site', position: { x: 1184, y: 96 }, background: 'purple' },
]
swap.objects = [
  node('wide-left', swap.sites[0].id, { x: 32, y: 64 }),
  node('wide-right', swap.sites[0].id, { x: 336, y: 64 }),
  node('small', swap.sites[1].id, { x: 32, y: 64 }),
  node('third', swap.sites[2].id, { x: 32, y: 64 }),
]
const history = project('History typing')
history.objects = [node('srv', undefined, { x: 64, y: 96 })]
const large = project('Drag to offscreen object')
large.objects = [
  node('near', undefined, { x: 64, y: 96 }),
  node('far', undefined, { x: 4096, y: 96 }),
]
const pageScene = structuredClone(membership)
pageScene.id = id()
pageScene.name = 'Screenshot scenario'
pageScene.sites[0].name = 'Москва 1'
pageScene.sites.push(
  { id: id(), name: 'Новосибирск 1', position: { x: 544, y: 96 } },
  { id: id(), name: 'Новосибирск Склад 1', position: { x: 1056, y: 96 }, background: 'purple' },
)
pageScene.groups.push({
  id: id(),
  name: 'Архив',
  siteId: pageScene.sites[2].id,
  position: { x: 16, y: 64 },
  background: 'peach',
})
pageScene.objects.push(
  node('orders-db', pageScene.sites[1].id, { x: 32, y: 64 }, undefined, 'database'),
  node('archive-01', pageScene.sites[2].id, { x: 16, y: 48 }, pageScene.groups[1].id),
  node('monitoring', undefined, { x: 576, y: 480 }, undefined, 'website'),
)
pageScene.links = [
  [0, 1, 'HTTPS'],
  [0, 2, 'HTTPS'],
  [1, 3, 'PostgreSQL'],
  [2, 3, 'PostgreSQL'],
  [3, 4, 'Backup'],
  [0, 4, 'HTTPS archive'],
  [5, 3, 'Monitoring'],
].map(([a, b, label]) => ({
  id: id(),
  from: pageScene.objects[a].id,
  to: pageScene.objects[b].id,
  label,
}))
const scenarios = [pageScene, duplicate, membership, swap, history, large]
const w = api.seedWorkspace('Architecture audit', false)
w.plugins.projectArchitecture = { enabled: true, projects: scenarios }
w.ui.tabs = [api.projectArchitectureTab]
w.ui.activeId = api.projectArchitectureTab
api.workspaceSchema.parse(w)
const snapshotPath = path.join(workspace, 'workspace.json')
await fs.writeFile(snapshotPath, JSON.stringify(w))
await fs.writeFile(
  path.join(root, 'spaces.json'),
  JSON.stringify({
    activeId: w.id,
    spaces: [{ id: w.id, name: w.name, icon: w.icon, path: workspace }],
  }),
)
const result = { root, rendererErrors: [], model: {}, ui: {} }
const persist = () =>
  fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
const beforeDup = geom(duplicate),
  copied = api.duplicateArchitectureObjects(duplicate, [duplicate.objects[0].id]),
  afterDup = geom(copied.project)
result.model.duplicate = {
  beforeFramesOverlap: overlap(...beforeDup.sites),
  afterFramesOverlap: overlap(...afterDup.sites),
  copiedCardIntersections: afterDup.nodes
    .filter(
      (n) =>
        n.object.id !== copied.ids[0] &&
        overlap(
          n,
          afterDup.nodes.find((n) => n.object.id === copied.ids[0]),
        ),
    )
    .map((n) => n.object.name),
}
const beforeSwap = geom(swap),
  afterSwap = geom(
    api.placeArchitectureSelection(
      swap,
      beforeSwap,
      'site',
      [swap.sites[0].id],
      { x: 736, y: 0 },
      0,
    ).project,
  )
result.model.swap = {
  beforeFramesOverlap: beforeSwap.sites.some((s, i) =>
    beforeSwap.sites.slice(i + 1).some((b) => overlap(s, b)),
  ),
  afterFramesOverlap: afterSwap.sites.some((s, i) =>
    afterSwap.sites.slice(i + 1).some((b) => overlap(s, b)),
  ),
  nodeIntersections: afterSwap.nodes.flatMap((n, i) =>
    afterSwap.nodes
      .slice(i + 1)
      .filter((b) => overlap(n, b))
      .map((b) => [n.object.name, b.object.name]),
  ),
}
const sceneLayout = geom(pageScene, true)
const pair = (edge) =>
  pageScene.objects.find((n) => n.id === edge.link.from).name +
  ' → ' +
  pageScene.objects.find((n) => n.id === edge.link.to).name
result.model.routing = {
  labelsCutByOtherLines: sceneLayout.edges.flatMap((edge) =>
    edge.label
      ? sceneLayout.edges
          .filter(
            (b) =>
              b !== edge &&
              b.points
                .slice(1)
                .some((p, i) =>
                  api.architectureSegmentIntersects(b.points[i], p, { ...edge.label, height: 18 }),
                ),
          )
          .map((other) => ({
            label: edge.link.label,
            crossingLine: other.link.label,
            labelFor: pair(edge),
            lineFor: pair(other),
            paintedAfterLabel: sceneLayout.edges.indexOf(other) > sceneLayout.edges.indexOf(edge),
          }))
      : [],
  ),
  parallelSharedPixels: [],
}
for (const [index, a] of sceneLayout.edges.entries())
  for (const b of sceneLayout.edges.slice(index + 1))
    for (let i = 1; i < a.points.length; i++)
      for (let j = 1; j < b.points.length; j++) {
        const aa = a.points[i - 1],
          ab = a.points[i],
          ba = b.points[j - 1],
          bb = b.points[j]
        const h = aa.y === ab.y && ba.y === bb.y && aa.y === ba.y,
          v = aa.x === ab.x && ba.x === bb.x && aa.x === ba.x
        const shared = h
          ? Math.min(Math.max(aa.x, ab.x), Math.max(ba.x, bb.x)) -
            Math.max(Math.min(aa.x, ab.x), Math.min(ba.x, bb.x))
          : v
            ? Math.min(Math.max(aa.y, ab.y), Math.max(ba.y, bb.y)) -
              Math.max(Math.min(aa.y, ab.y), Math.min(ba.y, bb.y))
            : 0
        if (shared > 0)
          result.model.routing.parallelSharedPixels.push({
            a: a.link.label,
            b: b.link.label,
            pairA: pair(a),
            pairB: pair(b),
            length: shared,
          })
      }
await persist()
let app, page
const planner = () => page.locator('.architecture-page:visible'),
  canvas = () => planner().locator('.architecture-diagram'),
  svg = () => canvas().locator('.architecture-diagram-canvas > div > svg'),
  panel = () => page.locator('.architecture-inspector:visible')
const saved = async () => expect(page.locator('.save-status')).toHaveClass(/\bsaved\b/)
const read = async (index) =>
  JSON.parse(await fs.readFile(snapshotPath, 'utf8')).plugins.projectArchitecture.projects[index]
async function select(name) {
  if (await panel().count())
    await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  await planner().getByRole('button', { name: 'Architecture project', exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await canvas().scrollIntoViewIfNeeded()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await planner().getByRole('button', { name: 'Fit diagram', exact: true }).click()
}
async function properties(kind, id) {
  await planner().locator(`[data-architecture-properties-${kind}="${id}"]`).click()
  await expect(panel()).toBeVisible()
}
const shot = (name) => page.screenshot({ path: path.join(output, name + '.png') })
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, SHECO_DATA_DIR: root } })
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => result.rendererErrors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1100))
  await expect(planner()).toBeVisible()
  await saved()
  result.ui.chrome = await planner().evaluate((node) => {
    const box = node.getBoundingClientRect(),
      canvas = node.querySelector('.architecture-diagram').getBoundingClientRect(),
      view = node.querySelector('.architecture-diagram-canvas > div > svg')
    return {
      pageTop: box.top,
      canvasTop: canvas.top,
      headerPixels: canvas.top - box.top,
      windowHeight: innerHeight,
      canvasHeight: canvas.height,
      zoom: view.getScreenCTM().a,
      labelPixelSize:
        Number(
          view.querySelector('[data-architecture-link-label] text')?.getAttribute('font-size'),
        ) * view.getScreenCTM().a,
    }
  })
  await shot('01-page-layout')
  await select(duplicate.name)
  await planner()
    .locator(`[data-architecture-object="${duplicate.objects[0].id}"] > rect`)
    .click({ button: 'right', position: { x: 25, y: 25 } })
  await page.getByRole('menuitem', { name: 'Duplicate object', exact: true }).click()
  await saved()
  const duplicateSaved = await read(1),
    duplicateGeometry = geom(duplicateSaved)
  result.ui.duplicate = {
    saved: true,
    framesOverlap: overlap(...duplicateGeometry.sites),
    copyPresent: duplicateSaved.objects.length === 4,
  }
  await shot('02-duplicate-overlap')
  await persist()
  await select(membership.name)
  await properties('group', membership.groups[0].id)
  await panel().getByRole('checkbox', { name: 'api-01', exact: true }).uncheck()
  await saved()
  await expect
    .poll(
      async () =>
        (await read(2)).objects.find((n) => n.id === membership.objects[1].id).groupId ?? null,
    )
    .toBe(null)
  await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  const memberSaved = await read(2),
    memberGeometry = geom(memberSaved),
    detached = memberGeometry.nodes.find((n) => n.object.id === membership.objects[1].id),
    group = memberGeometry.groups[0]
  result.ui.membership = {
    serverRetained: memberSaved.objects.length === 3,
    groupId: memberSaved.objects[1].groupId ?? null,
    overlapsGroup: overlap(detached, group),
    coversGroupHeading: overlap(detached, {
      x: group.x + 12,
      y: group.y + 8,
      width: group.width - 24,
      height: 34,
    }),
    position: detached,
  }
  await properties('group', membership.groups[0].id)
  const groupName = panel().getByRole('textbox', { name: 'Group name', exact: true })
  await groupName.fill('Renamed API group')
  await saved()
  await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  const stableGeometry = geom(await read(2))
  expect(stableGeometry.groups.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
    memberGeometry.groups.map(({ id, x, y }) => ({ id, x, y })),
  )
  expect(stableGeometry.nodes.map(({ object, x, y }) => ({ id: object.id, x, y }))).toEqual(
    memberGeometry.nodes.map(({ object, x, y }) => ({ id: object.id, x, y })),
  )
  await shot('03-removed-member-covers-group')
  await persist()
  await select(swap.name)
  const header = await planner()
      .locator(`[data-architecture-edit-site="${swap.sites[0].id}"] > rect`)
      .boundingBox(),
    scale = await svg().evaluate((node) => node.getScreenCTM().a)
  await page.mouse.move(header.x + 20, header.y + 10)
  await page.mouse.down()
  await page.mouse.move(header.x + 20 + 736 * scale, header.y + 10, { steps: 14 })
  await page.mouse.up()
  await saved()
  const swapSaved = geom(await read(3))
  result.ui.swap = {
    framesOverlap: swapSaved.sites.some((s, i) =>
      swapSaved.sites.slice(i + 1).some((b) => overlap(s, b)),
    ),
    nodeIntersections: swapSaved.nodes.flatMap((n, i) =>
      swapSaved.nodes
        .slice(i + 1)
        .filter((b) => overlap(n, b))
        .map((b) => [n.object.name, b.object.name]),
    ),
  }
  await shot('04-site-swap-overlap')
  await persist()
  await select(history.name)
  await properties('object', history.objects[0].id)
  const input = panel().getByRole('textbox', { name: 'Object name', exact: true })
  await input.press('End')
  await input.pressSequentially('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', { delay: 20 })
  await saved()
  const typedName = (await read(4)).objects[0].name
  await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  const undo = planner().getByRole('button', { name: 'Undo architecture change', exact: true })
  await undo.click()
  await saved()
  const oneUndo = (await read(4)).objects[0].name
  await planner().getByRole('button', { name: 'Redo architecture change', exact: true }).click()
  await saved()
  expect((await read(4)).objects[0].name).toBe(typedName)
  await undo.click()
  await saved()
  let undoCount = 1
  while ((await undo.isEnabled()) && undoCount < 35) {
    await undo.click()
    await saved()
    undoCount++
  }
  result.ui.history = {
    typedName,
    oneUndo,
    undoCount,
    afterAllUndo: (await read(4)).objects[0].name,
    originalName: history.objects[0].name,
  }
  await shot('05-undo-exhausted')
  await persist()
  await select(pageScene.name)
  const label = sceneLayout.edges[0].label
  const labelPoint = await svg().evaluate(
    (node, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(node.getScreenCTM())
      return { x: q.x, y: q.y }
    },
    { x: label.x + label.width / 2, y: label.y + 9 },
  )
  await canvas().evaluate((node, p) => {
    for (let i = 0; i < 2; i++)
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -200,
          clientX: p.x,
          clientY: p.y,
        }),
      )
  }, labelPoint)
  await shot('07-lines-over-labels-detail')
  await select(large.name)
  // Zoom around the near object until the other object is outside the viewport.
  const nearBox = await planner()
    .locator(`[data-architecture-object="${large.objects[0].id}"] > rect`)
    .boundingBox()
  await canvas().evaluate(
    (node, point) => {
      for (let i = 0; i < 4; i++)
        node.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -200,
            clientX: point.x,
            clientY: point.y,
          }),
        )
    },
    { x: nearBox.x + nearBox.width / 2, y: nearBox.y + nearBox.height / 2 },
  )
  const camera = () =>
    svg().evaluate((node) => ({
      x: node.viewBox.baseVal.x,
      y: node.viewBox.baseVal.y,
      zoom: node.getScreenCTM().a,
    }))
  const beforeCamera = await camera(),
    view = await canvas().boundingBox(),
    near = await planner()
      .locator(`[data-architecture-object="${large.objects[0].id}"] > rect`)
      .boundingBox()
  const beforeDrag = await read(5)
  const hit = {
    x: (Math.max(near.x, view.x + 1) + Math.min(near.x + near.width, view.x + view.width - 1)) / 2,
    y:
      (Math.max(near.y, view.y + 1) + Math.min(near.y + near.height, view.y + view.height - 1)) / 2,
  }
  await page.mouse.move(hit.x, hit.y)
  await page.mouse.down()
  await page.mouse.move(view.x + view.width - 3, view.y + view.height / 2, { steps: 14 })
  await expect(
    planner().locator(`[data-architecture-object="${large.objects[0].id}"]`),
  ).toHaveAttribute('transform', /translate/)
  await page.waitForTimeout(1200)
  const edgeCamera = await camera()
  await page.mouse.wheel(400, 0)
  const wheelDuringDrag = await camera()
  await shot('06-drag-at-edge')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  result.ui.offscreenDrag = {
    beforeCamera,
    edgeCamera,
    wheelDuringDrag,
    cameraStaysStill: JSON.stringify(beforeCamera) === JSON.stringify(wheelDuringDrag),
    cancellationPreservedProject: isDeepStrictEqual(await read(5), beforeDrag),
  }
  await saved()
  await persist()
  expect(result.model.duplicate.afterFramesOverlap).toBe(false)
  expect(result.model.duplicate.copiedCardIntersections).toEqual([])
  expect(result.model.swap.afterFramesOverlap).toBe(false)
  expect(result.model.swap.nodeIntersections).toEqual([])
  expect(result.model.routing.labelsCutByOtherLines).toEqual([])
  expect(result.model.routing.parallelSharedPixels).toEqual([])
  expect(result.ui.duplicate.framesOverlap).toBe(false)
  expect(result.ui.membership.overlapsGroup).toBe(false)
  expect(result.ui.swap.framesOverlap).toBe(false)
  expect(result.ui.history.oneUndo).toBe('srv')
  expect(result.ui.history.undoCount).toBe(1)
  expect(result.ui.offscreenDrag.edgeCamera.x).toBeGreaterThan(beforeCamera.x + 100)
  expect(result.ui.offscreenDrag.wheelDuringDrag.x).toBeGreaterThan(
    result.ui.offscreenDrag.edgeCamera.x + 100,
  )
  expect(result.ui.offscreenDrag.cancellationPreservedProject).toBe(true)
  expect(result.rendererErrors).toEqual([])
  // A pause splits typing actions; keyboard Redo and a new field keep boundaries.
  await select(history.name)
  await properties('object', history.objects[0].id)
  const nameField = panel().getByRole('textbox', { name: 'Object name', exact: true })
  await nameField.press('End')
  await nameField.pressSequentially('ABC', { delay: 20 })
  await page.waitForTimeout(1300)
  await nameField.pressSequentially('DEF', { delay: 20 })
  await saved()
  await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  await undo.click()
  await saved()
  expect((await read(4)).objects[0].name).toBe('srvABC')
  await canvas().focus()
  await page.keyboard.press('Control+Shift+z')
  await saved()
  expect((await read(4)).objects[0].name).toBe('srvABCDEF')
  await undo.click()
  await saved()
  await properties('object', history.objects[0].id)
  await panel().getByRole('spinbutton', { name: 'CPU · cores', exact: true }).fill('6')
  await saved()
  await expect(
    planner().getByRole('button', { name: 'Redo architecture change', exact: true }),
  ).toBeDisabled()
  await panel().getByRole('button', { name: 'Close properties', exact: true }).click()
  await undo.click()
  await saved()
  expect((await read(4)).objects[0]).toMatchObject({ name: 'srvABC', resources: { cpu: 4 } })
  // Draw across an offscreen distance without ending the gesture to navigate.
  await select(large.name)
  await planner().getByRole('button', { name: 'Find object', exact: true }).click()
  await page.getByRole('option', { name: /^near ·/ }).click()
  const portBox = await planner()
    .locator(`[data-architecture-connect="${large.objects[0].id}"]`)
    .boundingBox()
  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2)
  await page.mouse.down()
  const linkViewport = await canvas().boundingBox()
  await page.mouse.move(
    linkViewport.x + linkViewport.width - 3,
    linkViewport.y + linkViewport.height / 2,
    { steps: 8 },
  )
  const linkBeforeCamera = await camera()
  await page.waitForTimeout(350)
  expect((await camera()).x).toBeGreaterThan(linkBeforeCamera.x + 20)
  const currentView = await svg().evaluate((node) => ({
    x: node.viewBox.baseVal.x,
    y: node.viewBox.baseVal.y,
    width: node.viewBox.baseVal.width,
    height: node.viewBox.baseVal.height,
    zoom: node.getScreenCTM().a,
  }))
  await canvas().evaluate(
    (node, delta) =>
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: delta.x,
          deltaY: delta.y,
        }),
      ),
    {
      x: (4096 + 144 - currentView.x - currentView.width / 2) * currentView.zoom,
      y: (96 + 72 - currentView.y - currentView.height / 2) * currentView.zoom,
    },
  )
  const far = await planner()
    .locator(`[data-architecture-object="${large.objects[1].id}"] > rect`)
    .boundingBox()
  await page.mouse.move(far.x + far.width / 2, far.y + far.height / 2)
  await expect(
    planner().locator(`[data-architecture-object="${large.objects[1].id}"]`),
  ).toHaveClass(/connection-target/)
  await page.mouse.up()
  await saved()
  expect((await read(5)).links).toHaveLength(1)
  expect((await read(5)).links[0]).toMatchObject({
    from: large.objects[0].id,
    to: large.objects[1].id,
    label: '',
  })
  result.ui.typingBoundariesAndRedoBranch = true
  result.ui.offscreenConnection = true
  await persist()
  // Search moves the camera across filtered sites, selects the result and dims unrelated links.
  await select(pageScene.name)
  await planner().getByRole('button', { name: 'Architecture site', exact: true }).click()
  await page.getByRole('option', { name: 'Москва 1', exact: true }).click()
  await planner().getByRole('button', { name: 'Find object', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search objects', exact: true }).fill('archive-01')
  await page.getByRole('option', { name: /archive-01/ }).click()
  await expect(
    planner().locator(`[data-architecture-object="${pageScene.objects[4].id}"]`),
  ).toHaveClass(/selected/)
  await expect(planner().locator('[data-architecture-link].connection-muted')).not.toHaveCount(0)
  await shot('10-search-focus')
  await page.keyboard.press('Escape')
  await expect(planner().locator('.connection-muted')).toHaveCount(0)
  expect(result.ui.chrome.headerPixels).toBeLessThan(235)
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await app.close()
  }
}
console.log(JSON.stringify({ output, root, result }, null, 2))
