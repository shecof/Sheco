# Sheco

A local home for your knowledge.

Sheco is a desktop knowledge app for **macOS and Windows**. Write notes, connect pages,
organize databases, and keep your documents in folders you own. No account or hosted backend
is required. The interface supports **English and Russian**.

[Русский](README.ru.md) · [User guide](docs/user-guide.md) ·
[Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) ·
[Repository](https://github.com/shecof/Sheco)

![Sheco's block editor with a project notebook, tasks, connected pages, and an outline](docs/screenshots/editor-en.png)

## Features

- **Connected pages:** nested pages, tabs, favorites, wiki links, backlinks, workspace search,
  and find and replace within a page.
- **Block editor:** rich text, lists and tasks, folds, callouts, code with highlighting and
  comments, math, simple tables, and Mermaid diagrams with a visual editor for basic flowcharts.
- **Local media:** images, galleries, captions, reversible cropping, and file attachments.
- **Databases:** records are complete pages, with typed properties, relations, filters, sorting,
  and table, list, board, and gallery views. Embed a database inside a note.
- **Portable data:** Markdown import/export, CSV database export, PDF page export, and complete
  workspace exports with attachments.
- **Durable saves:** revision checks, atomic replacement, backup checkpoints, recovery,
  and recoverable Trash.
- **Optional integrations:** authenticated local MCP access for AI clients, and a configurable
  command builder that copies commands. MCP is disabled by default; the builder never runs commands.
- **Comfortable reading:** light/dark/system appearance, accent colors, page outline,
  reading width and font-size controls.

## A closer look

**Organize a collection.** Use typed properties, status tags, and notes to keep useful references
together. Every database entry opens as a complete page.

![A reading-list database in Sheco with status, topic, and note properties](docs/screenshots/database-en.png)

**See the same collection as a board.** Switch views to follow progress, with light and dark
themes for your workspace.

![The reading list shown as a board in Sheco's dark theme](docs/screenshots/board-dark-en.png)

Screenshots show the macOS app with fictional demo content. [About the screenshots](docs/screenshots/README.md).

## Project status

Sheco is in active development. This repository contains source code and a macOS/Windows CI
workflow. The repository is currently private; public installers have not been published.
Build from source using the commands below. Linux packaging and runtime verification are not provided.

Check the [CI results](https://github.com/shecof/Sheco/actions) for the revision you use.
A configured CI job or an existing installer is not proof that the current revision passed on
every platform. See [release preparation](docs/releasing.md) for distribution requirements.

## Try it from source

Requires **Node.js 22.12+**, npm, and macOS or Windows. From the project directory:

```sh
npm ci
```

Use a fresh data folder for your first source run, so development stays separate from your usual
Sheco workspaces.

**macOS / POSIX shell**

```sh
sheco_dev_data=$(mktemp -d "${TMPDIR:-/tmp}/sheco-dev.XXXXXX")
SHECO_DATA_DIR="$sheco_dev_data" npm run dev
```

**Windows PowerShell**

```powershell
$shecoDevData = Join-Path ([System.IO.Path]::GetTempPath()) ('sheco-dev-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $shecoDevData | Out-Null
$env:SHECO_DATA_DIR = $shecoDevData
npm run dev
Remove-Item Env:SHECO_DATA_DIR
```

The first isolated run creates a sample **Pentest** workspace under that folder's `Knowledge/`
directory. Use the workspace menu to create an empty workspace or open your own folder.
Running `npm run dev` without the override uses normal app data and can create
`Documents/Sheco/Pentest`. See the [development guide](docs/development/development.md) for preview
and debugging instructions.

## Your data

A workspace contains `workspace.json`, `attachments/`, and recovery metadata. The JSON snapshot
is the source of truth; Markdown and CSV are readable exports, not lossless backups. Use
**Settings → Export workspace** or copy the entire workspace folder after closing its writer.

Documents and backups are **not encrypted**. Third-party folder synchronization does not provide
collaborative editing: edit a workspace on one device at a time. Normal attachment imports are
limited to 200 MiB per file, snapshots to 64 MiB, and MCP file operations to 8 MiB. Search runs in
memory and database views are not virtualized. Read more in the [user guide](docs/user-guide.md)
and [security policy](SECURITY.md).

## Develop and contribute

Built with Electron, React, TypeScript, and Tiptap/ProseMirror.

```sh
npm run check       # Type checking, unit tests, production build
npm run test:e2e    # Electron workflows in a temporary workspace
npm run pack        # Runnable app directory for the current OS
```

The [contribution guide](CONTRIBUTING.md) covers setup, regression checks, and pull requests.
The [testing matrix](docs/development/testing.md) lists focused desktop suites;
the [development guides](docs/development/README.md) describe the implementation.

| Directory   | Purpose                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `src/`      | React interface, editor, live state, and shared model/validation/export helpers   |
| `electron/` | Desktop lifecycle, fixed preload API, filesystem storage, and local MCP transport |
| `tests/`    | Unit and regression tests                                                         |
| `scripts/`  | Development, build, packaging helpers, and desktop review suites                  |
| `build/`    | Logo and platform icon assets; dependency notices generated during builds         |
| `docs/`     | User documentation, development guides, and release preparation                   |
| `.github/`  | CI and contribution templates                                                     |

Dependencies, compiled output, installers, and local test/preview data are excluded from Git.
`test-results/design-preview/` is persistent user data even though it is ignored.

## Security and license

Report vulnerabilities privately to **[shecof@ya.ru](mailto:shecof@ya.ru)**. Do not include
credentials or personal workspaces in public reports. See [SECURITY.md](SECURITY.md).

Sheco is licensed under the [MIT License](LICENSE). Dependencies retain their own licenses;
`npm run notices` generates `build/THIRD_PARTY_NOTICES.txt` for packaged distributions.
