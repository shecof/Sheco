import type { ArchitectureBounds, ArchitecturePoint } from './projectArchitecture'

// Search the local corridor first. The full 500-card graph need not contribute
// thousands of axes to a short link; widen only when obstacles require it.
export function routeArchitectureObstacles(
  start: ArchitecturePoint,
  end: ArchitecturePoint,
  obstacles: ArchitectureBounds[],
  reserved: [ArchitecturePoint, ArchitecturePoint][] = [],
) {
  for (const margin of [32, 128, 512, Infinity]) {
    const left = Math.min(start.x, end.x) - margin,
      right = Math.max(start.x, end.x) + margin,
      top = Math.min(start.y, end.y) - margin,
      bottom = Math.max(start.y, end.y) + margin
    const nearby = obstacles.filter(
      (box) =>
        box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top,
    )
    const segments = reserved
      .filter(
        ([a, b]) =>
          Math.max(a.x, b.x) >= left &&
          Math.min(a.x, b.x) <= right &&
          Math.max(a.y, b.y) >= top &&
          Math.min(a.y, b.y) <= bottom,
      )
      .map(([a, b]): [ArchitecturePoint, ArchitecturePoint] => [
        { x: Math.max(left, Math.min(right, a.x)), y: Math.max(top, Math.min(bottom, a.y)) },
        { x: Math.max(left, Math.min(right, b.x)), y: Math.max(top, Math.min(bottom, b.y)) },
      ])
    const found = searchArchitectureRoute(start, end, nearby, segments, {
      left,
      right,
      top,
      bottom,
    })
    if (found) return found
  }
  return null
}
// Most links use the inexpensive two/three-bend routes. This bounded, lazy grid
// search handles manually arranged obstacles that need more turns.
function searchArchitectureRoute(
  start: ArchitecturePoint,
  end: ArchitecturePoint,
  obstacles: ArchitectureBounds[],
  reserved: [ArchitecturePoint, ArchitecturePoint][],
  bounds: { left: number; right: number; top: number; bottom: number },
): ArchitecturePoint[] | null {
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...reserved.filter(([a, b]) => a.x === b.x).flatMap(([a]) => [a.x - 8, a.x + 8]),
      ...obstacles.flatMap((box) => [box.x - 8, box.x + box.width + 8]),
    ]),
  ]
    .filter((value) => value >= bounds.left && value <= bounds.right)
    .sort((a, b) => a - b)
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...reserved.filter(([a, b]) => a.y === b.y).flatMap(([a]) => [a.y - 8, a.y + 8]),
      ...obstacles.flatMap((box) => [box.y - 8, box.y + box.height + 8]),
    ]),
  ]
    .filter((value) => value >= bounds.top && value <= bounds.bottom)
    .sort((a, b) => a - b)
  const columns = xs.length,
    source = ys.indexOf(start.y) * columns + xs.indexOf(start.x),
    target = ys.indexOf(end.y) * columns + xs.indexOf(end.x)
  const rows = new Map<number, [number, number][]>(),
    verticals = new Map<number, [number, number][]>()
  const reservedRows = new Map<number, [number, number][]>(),
    reservedColumns = new Map<number, [number, number][]>()
  for (const [a, b] of reserved) {
    const vertical = a.x === b.x,
      key = vertical ? a.x : a.y,
      cache = vertical ? reservedColumns : reservedRows,
      axis = vertical ? 'y' : 'x'
    if (!cache.has(key)) cache.set(key, [])
    cache.get(key)!.push([Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])])
  }
  function intervals(axis: 'x' | 'y', index: number) {
    const cache = axis === 'x' ? rows : verticals
    const found = cache.get(index)
    if (found) return found
    const cross = axis === 'x' ? 'y' : 'x',
      length = axis === 'x' ? 'width' : 'height',
      span = axis === 'x' ? 'height' : 'width',
      value = axis === 'x' ? ys[index] : xs[index]
    const ranges = obstacles
      .filter((box) => value > box[cross] - 6 + 0.001 && value < box[cross] + box[span] + 6 - 0.001)
      .map((box): [number, number] => [box[axis] - 6, box[axis] + box[length] + 6])
      .sort((a, b) => a[0] - b[0])
    ranges.push(...((axis === 'x' ? reservedRows : reservedColumns).get(value) ?? []))
    ranges.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const range of ranges) {
      const last = merged.at(-1)
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
      else merged.push(range)
    }
    cache.set(index, merged)
    return merged
  }
  function clear(axis: 'x' | 'y', index: number, a: number, b: number) {
    const ranges = intervals(axis, index),
      min = Math.min(a, b),
      max = Math.max(a, b)
    let low = 0,
      high = ranges.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (ranges[mid][1] <= min + 0.001) low = mid + 1
      else high = mid
    }
    return low === ranges.length || ranges[low][0] >= max - 0.001
  }
  const coordinate = (id: number) => ({ x: xs[id % columns], y: ys[Math.floor(id / columns)] })
  const cost = new Map<number, number>([[source, 0]]),
    previous = new Map<number, number>(),
    visited = new Set<number>(),
    heap: { id: number; score: number }[] = []
  function push(item: (typeof heap)[number]) {
    let index = heap.length
    heap.push(item)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (heap[parent].score <= item.score) break
      heap[index] = heap[parent]
      index = parent
    }
    heap[index] = item
  }
  function pop() {
    const first = heap[0],
      last = heap.pop()!
    if (heap.length) {
      let index = 0
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++
        if (heap[child].score >= last.score) break
        heap[index] = heap[child]
        index = child
      }
      heap[index] = last
    }
    return first.id
  }
  push({ id: source, score: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) })
  while (heap.length && visited.size < 30_000) {
    const id = pop()
    if (id === target) {
      const route = [coordinate(id)]
      let cursor = id
      while (previous.has(cursor)) {
        cursor = previous.get(cursor)!
        route.push(coordinate(cursor))
      }
      return route.reverse()
    }
    if (visited.has(id)) continue
    visited.add(id)
    const x = id % columns,
      y = Math.floor(id / columns),
      point = coordinate(id)
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        next = ny * columns + nx
      if (nx < 0 || nx >= columns || ny < 0 || ny >= ys.length || visited.has(next)) continue
      const proposed = { x: xs[nx], y: ys[ny] }
      if (!(dx ? clear('x', y, point.x, proposed.x) : clear('y', x, point.y, proposed.y))) continue
      const parent = previous.get(id),
        turn = parent !== undefined && (Math.floor(parent / columns) === y) !== (dy === 0)
      const distance =
        cost.get(id)! +
        Math.abs(point.x - proposed.x) +
        Math.abs(point.y - proposed.y) +
        (turn ? 12 : 0)
      if (distance >= (cost.get(next) ?? Infinity)) continue
      previous.set(next, id)
      cost.set(next, distance)
      push({
        id: next,
        // A slight goal bias avoids exploring every equal-length corridor of a
        // very tall graph before reaching its distant return endpoint.
        score: distance + 1.15 * (Math.abs(proposed.x - end.x) + Math.abs(proposed.y - end.y)),
      })
    }
  }
  return null
}

// Horizontal routes jump over vertical routes. Keep the curve geometry in the route
// cache; typing labels must not repeat intersection work for a large project.
export function architectureRouteBridges(
  routes: ArchitecturePoint[][],
  obstacles: ArchitectureBounds[] = [],
) {
  type Segment = {
    a: ArchitecturePoint
    b: ArchitecturePoint
    edge: number
    horizontal: boolean
    low: number
    high: number
    fixed: number
    jumps: { x: number; radius: number; lift: number }[]
  }
  const segments = routes.map((points, edge) =>
    points.slice(1).map((b, index): Segment => {
      const a = points[index],
        horizontal = a.y === b.y
      return {
        a,
        b,
        edge,
        horizontal,
        low: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
        high: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
        fixed: horizontal ? a.y : a.x,
        jumps: [],
      }
    }),
  )
  const verticals = segments
    .flat()
    .filter((segment) => !segment.horizontal)
    .sort((a, b) => a.fixed - b.fixed)
  const horizontals = segments
    .flat()
    .filter((segment) => segment.horizontal)
    .sort((a, b) => a.fixed - b.fixed)
  const endpoints = routes
    .flatMap((points) => (points.length ? [points[0], points.at(-1)!] : []))
    .map((point) => ({ ...point, fixed: point.x }))
    .sort((a, b) => a.fixed - b.fixed)
  // Index local corridors rather than checking every line/endpoint for each hump.
  function nearby<T extends { fixed: number }>(items: T[], low: number, high: number): T[] {
    let left = 0,
      right = items.length
    while (left < right) {
      const middle = (left + right) >>> 1
      if (items[middle].fixed < low) left = middle + 1
      else right = middle
    }
    const found: T[] = []
    while (left < items.length && items[left].fixed <= high) found.push(items[left++])
    return found
  }
  const intersects = (a: ArchitectureBounds, b: ArchitectureBounds) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  // Leave clearance even when the crossing is selected (2.5px stroke, round caps).
  const strokePadding = 1.25,
    arrowClearance = 16
  for (const segment of horizontals) {
    const { a, b, edge, low, high } = segment
    const sign = Math.sign(b.x - a.x)
    const crossed = nearby(verticals, low + 7, high - 7).filter(
      (other) => other.edge !== edge && a.y > other.low + 1 && a.y < other.high - 1,
    )
    const crossings = [...new Set(crossed.map((other) => other.fixed))]
      .sort((x, y) => sign * (x - y))
      .slice(0, 64)
    for (const [index, x] of crossings.entries()) {
      const radius = Math.min(
        5,
        Math.abs(x - (crossings[index - 1] ?? a.x)) / 2 - 1,
        Math.abs(x - (crossings[index + 1] ?? b.x)) / 2 - 1,
      )
      if (radius < 2) continue
      const underpasses = crossed.filter((other) => other.fixed === x)
      const lift = [-1, 1].find((side) => {
        const box = {
          x: x - radius - strokePadding,
          y: a.y + Math.min(0, side * radius) - strokePadding,
          width: (radius + strokePadding) * 2,
          height: radius + strokePadding * 2,
        }
        const peak = a.y + side * radius
        if (
          underpasses.some(
            (other) => peak - strokePadding <= other.low || peak + strokePadding >= other.high,
          )
        )
          return false
        if (obstacles.some((other) => intersects(box, other))) return false
        // Reserve both ends, including currently hidden arrowheads, so changing
        // direction/style remains metadata-only and cannot reintroduce overlaps.
        if (
          nearby(endpoints, box.x - arrowClearance, box.x + box.width + arrowClearance).some(
            (point) =>
              Math.hypot(
                Math.max(box.x - point.x, 0, point.x - box.x - box.width),
                Math.max(box.y - point.y, 0, point.y - box.y - box.height),
              ) < arrowClearance,
          )
        )
          return false
        if (
          nearby(horizontals, box.y, box.y + box.height).some(
            (other) => other !== segment && other.high > box.x && other.low < box.x + box.width,
          )
        )
          return false
        return !nearby(verticals, box.x, box.x + box.width).some(
          (other) =>
            !underpasses.includes(other) && other.high > box.y && other.low < box.y + box.height,
        )
      })
      if (!lift) continue
      segment.jumps.push({ x, radius, lift })
    }
  }
  return segments.map((parts, edge) => {
    const first = routes[edge][0]
    let path = first ? `M ${first.x} ${first.y}` : '',
      strokePath = path
    const bridges: string[] = []
    for (const { a, b, horizontal, jumps } of parts) {
      if (horizontal) {
        const sign = Math.sign(b.x - a.x)
        for (const { x, radius, lift } of jumps) {
          const start = `${x - sign * radius} ${a.y}`,
            end = `${x + sign * radius} ${a.y}`
          const curve = `A ${radius} ${radius} 0 0 ${sign * lift < 0 ? 1 : 0} ${end}`
          path += ` L ${start} ${curve}`
          strokePath += ` L ${start} M ${end}`
          bridges.push(`M ${start} ${curve}`)
        }
      }
      path += ` L ${b.x} ${b.y}`
      strokePath += ` L ${b.x} ${b.y}`
    }
    return { path, strokePath, bridges }
  })
}
