export const releasesUrl = 'https://github.com/shecof/Sheco/releases'
export const latestReleaseApi = 'https://api.github.com/repos/shecof/Sheco/releases/latest'
export type UpdateResult = {
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  status: 'current' | 'available' | 'unavailable' | 'error'
  error?: 'network' | 'rate-limit' | 'invalid-release' | 'no-release'
  checkedAt: string
}
export type UpdateSettings = { checkOnStartup: boolean }
export type UpdateRelease = { version: string; url: string }
export type AppUpdateState = {
  currentVersion: string
  settings: UpdateSettings
  checking: boolean
  result: UpdateResult | null
  availableRelease: UpdateRelease | null
  revision: number
}
export function parseVersion(text: string) {
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      text.trim(),
    )
  if (!match || [match[1], match[2], match[3]].some((value) => value.length > 9)) return null
  const pre = match[4]?.split('.') ?? []
  if (
    pre.some((value) => !value || /^0\d+$/.test(value)) ||
    match[5]?.split('.').some((value) => !value)
  )
    return null
  return { core: match.slice(1, 4).map(Number), pre }
}
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left),
    b = parseVersion(right)
  if (!a || !b) return null
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i])
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length)
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numericX = /^\d+$/.test(x),
      numericY = /^\d+$/.test(y)
    if (numericX && numericY)
      return x.length !== y.length ? Math.sign(x.length - y.length) : x < y ? -1 : 1
    if (numericX !== numericY) return numericX ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
