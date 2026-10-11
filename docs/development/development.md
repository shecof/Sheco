# Development, preview, and release

## Setup and commands

Use Node.js 22.12+ and npm. `npm ci` installs the tree pinned in `package-lock.json`. Commands
below run from the repository root. Inspect `package.json` when changing the workflow.

| Command             | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run dev`       | Builds Electron code, starts Vite at `127.0.0.1:5173`, launches Electron  |
| `npm run typecheck` | Strict TypeScript check without emitting files                            |
| `npm test`          | Vitest unit tests                                                         |
| `npm run build`     | Notices, typecheck, Vite production bundle, Electron main/preload bundles |
| `npm run check`     | Typecheck, unit tests, and production build                               |
| `npm run preview`   | Opens compiled app with the persistent design preview workspace           |
| `npm run pack`      | Builds and creates a runnable app directory for the current OS            |
| `npm run dist:mac`  | Builds macOS DMG/ZIP for arm64 and x64; does not publish                  |
| `npm run dist:win`  | Builds Windows NSIS/ZIP; does not publish                                 |
| `npm run icons`     | Regenerates platform icons from the selected logo artwork                 |
| `npm run notices`   | Regenerates production dependency license notices                         |

The renderer builds into `dist/`. Electron uses esbuild to produce CommonJS main/preload bundles
in `dist-electron/`, targeting Node 22 with Electron external. Fix source files, then rebuild;
editing generated output makes the next build discard the change. Main/preload changes in a dev
session require rebuilding/restarting the app; the script is not a main-process watcher.

Platform icons (`build/icon.svg`, `.png`, `.ico`, `.icns`) are committed packaging inputs so a
fresh checkout can package on either OS. `npm run icons` regenerates PNG/ICO and, on macOS using
`iconutil`, ICNS. Dependency notices are generated from the installed tree by each build and
ignored by Git; packaged output includes the notices and `LICENSE`.

## Isolate development data

`SHECO_DATA_DIR` overrides Electron's user data directory. For a fresh development fixture, use a
new temporary folder rather than the existing preview or a normal workspace:

```sh
# macOS / POSIX shell; keep this folder if you need to inspect a failed reproduction.
sheco_task_data=$(mktemp -d "${TMPDIR:-/tmp}/sheco-dev.XXXXXX")
SHECO_DATA_DIR="$sheco_task_data" npm run dev
```

```powershell
# Windows PowerShell
$shecoTaskData = Join-Path ([System.IO.Path]::GetTempPath()) ('sheco-dev-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $shecoTaskData | Out-Null
$env:SHECO_DATA_DIR = $shecoTaskData
npm run dev
Remove-Item Env:SHECO_DATA_DIR
```

Without an override, development opens normal app data and can create the default workspace in
Documents. The dev URL allowlist is deliberately restricted to `http://127.0.0.1:5173`.
Do not loosen origin checks to work around a port collision; stop your own conflicting process or
change the source/configuration consistently for an explicitly requested workflow.

## Design preview

Rebuild after code changes, then launch `npm run preview`. The preview script does **not** build
the application. It uses `test-results/design-preview/` for the registry and `Knowledge/` workspace,
seeding only when the registry is absent. Reuse existing contents without resetting them.

If a preview is already running, close it normally so pending saves finish before reopening the
updated build. Do not launch a second writer against its folder. Keep the user's page content,
Trash, attachments, settings, and MCP permissions intact. A screenshot review is not authorization
to restore deleted pages or populate the user's workspace with test content.

Review relevant behavior in the source preview before preparing release artifacts.
Build/test commands do not package the app;
`pack` produces a runnable app directory, while `dist:*` produces installers and archives.
Existing `release/` files can be older than the current source.

`pack` and `dist:*` reserve a fresh `release/YYYY-MM-DD-mac` or `release/YYYY-MM-DD-win` folder
through `scripts/package.mjs`; subsequent same-day builds use `-02`, `-03`, etc. Keep artifacts
and their unpacked apps/metadata together. Explicit output overrides remain supported; use a new
folder. See [release preparation](../releasing.md#local-artifact-layout) for the naming convention.

## Debugging and completion

- Save conflict: inspect state revision, queue ordering, lock owner, and disk fingerprint. Reproduce
  in a fixture; do not bypass revision checks or rewrite the user's snapshot.
- Disappearing typing: inspect stale closures, save reconciliation, and remote editor synchronization.
- Clipped/offset popover: inspect anchor coordinates, portal ownership, scroll containers, and
  viewport measurements. See the [UI guide](ui.md).
- Import/drop failure: inspect async page/workspace identity, mapped document positions, ordering,
  and cancellation. See the [editor guide](editor.md).

Use targeted formatting, for example `npx --no-install prettier --write path/to/changed-file.tsx`.
`npm run format` touches broad source/configuration sets and does not cover every documentation file;
avoid it for a focused edit. Add dependencies only for a concrete need, preserve the lockfile,
and check bundle compatibility, notices, and security implications when upgrading.

CI in `.github/workflows/desktop.yml` runs Node 22 on macOS and Windows, performs `check` and
`test:e2e`, then packages each platform. Specialized review suites are currently run separately.
Packaging for Windows on a Mac is not evidence of Windows runtime behavior. For trusted public
binary distribution, configure platform signing and macOS notarization; never commit credentials,
publish implicitly, or describe unsigned artifacts as signed. Source publication is a separate
step. Consult [release preparation](../releasing.md) for publication and artifact checks.
