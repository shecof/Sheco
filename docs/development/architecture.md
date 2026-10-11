# Architecture and data ownership

## Source map

| Owner                                          | Responsibility                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `electron/main.ts`                             | App lifecycle, workspace registry, native dialogs, protocols, IPC, and MCP dispatch  |
| `electron/preload.ts`, `src/shared/api.ts`     | Fixed, typed renderer-to-main API and event subscriptions                            |
| `electron/storage.ts`                          | Workspace validation on disk, writer ownership, durable saves, recovery, attachments |
| `electron/mcp.ts`                              | Optional authenticated local MCP transport and configuration                         |
| `src/state.tsx`                                | Live workspace state, serialized saves, transitions, and remote edit coordination    |
| `src/shared/model.ts`                          | Validated domain model, hierarchy, search, and database helpers                      |
| `src/shared/plugins.ts`, `pluginTools.ts`      | Validated plugin configuration, curated tool definitions and pure command assembly   |
| `src/shared/mcp.ts`                            | MCP schemas, catalog, and pure workspace operations                                  |
| `src/App.tsx`, `src/components/`               | Window navigation, page layout, settings, search, and database views                 |
| `src/editor/`                                  | ProseMirror schema, node views, controls, selection, and media editing               |
| `src/shared/export.ts`, `image.ts`, `media.ts` | Portable representations, crop geometry, and batch media helpers                     |
| `src/i18n.tsx`, `src/shared/i18n.ts`           | Language preference, translation context, and Russian strings                        |
| `src/theme.css`, `src/styles.css`              | Theme tokens, layout, editor presentation, and print rules                           |

## Data model

The current workspace format has `schemaVersion: 1`, a UUID, and an integer revision. It contains
pages, database schemas, attachment metadata, and UI state. The Zod model checks identities,
hierarchy cycles, missing parents, database membership, and tab validity. Its recursive `DocNode`
schema validates the JSON envelope; full editor grammar is checked separately in
`src/editor/documentSchema.ts`.

`plugins.commandBuilder` owns its per-workspace enabled state and versioned tool catalog. Legacy
snapshots get disabled defaults. UI tabs accept page UUIDs, `plugin:command-builder` (valid only while enabled), and
`plugin:command-builder-settings` (available even while disabled). Opening pages from a plugin appends a page tab, and disabling the
plugin removes the builder tab through the state/save pipeline without deleting its catalog or
closing the configuration tab. Configuration drafts remain in memory until Apply or tab close. Command
values stay in the renderer session and are excluded from snapshots and portable plugin JSON.
Plugin import/export uses fixed, sender-checked main-process methods and validated JSON up to
1 MiB. Definitions are data and never execute code or start commands. See [plugins](../plugins.md).
The workspace-only `catalogRevision` stamp upgrades untouched original built-ins once; frozen
`builtinToolsV1` definitions are the comparison baseline. Customized tools, deletions, ordering
and later imports remain unchanged. The stamp is excluded from portable catalog JSON.
Text-parameter `choices` provide suggestions without restricting free input. Tool `outputPresets`
store labels, compatible shells and arrays of command/argument tokens; assembly quotes every
token before joining stages with pipes. Preset selection stays in the renderer session.

- A page has a stable ID, optional parent, document root, metadata, properties, and timestamps.
- A database has its own schema ID and a backing page with `kind: 'database'`. Each such page
  has exactly one schema. Entry pages belong to that schema and have its page as their parent.
- Entry values are keyed by stable column IDs. Renaming a column must not move or erase values.
- Database presentation includes property-column widths and `titleWidth` for the Name column.
  Older snapshots receive a compatible 220px title width; resizing uses the existing state/save
  pipeline and commits only the completed gesture.
- A `databaseEmbed` node references the backing page's ID. A note can contain this block while
  the schema and record pages remain independent entities.
- Trash uses `deletedAt`; descendants and missing link targets need consistent treatment.
  Deletion must not silently destroy content or break recoverability.
- Use `nextTimestamp` for guarded page mutations so consecutive local and remote changes within
  a millisecond have distinct versions. Do not assume arbitrary direct mutations update timestamps.

When changing the format, check old snapshots, constructors, seed fixtures, exporters, IPC, MCP,
and every read/write consumer. Add compatible defaults or an explicit migration as appropriate;
do not only change a TypeScript interface or bump the schema number.

## Save and edit flow

```text
UI / editor / validated MCP operation
  -> immutable WorkspaceProvider state
  -> serialized flush with expected revision
  -> fixed preload API / validated main handler
  -> WorkspaceStore: validate, check lock/revision/fingerprint, back up, atomically replace
```

The provider tracks edit and saved sequences, debounces saves, and keeps at most one save in
flight. A completed save reconciles its returned revision with newer typing; it must not restore
an older page snapshot over current state. Workspace switching and window close wait for pending
operations and saves. A failure retains the unsaved state and offers recovery rather than
automatically overwriting disk.

MCP runs through the same live state queue. It flushes pending edits, validates the document,
rechecks workspace/deadline, applies the operation, and flushes the result. `remoteEdits` tells an
open editor when external content changed. Replacing editor content on every ordinary React
render can erase local typing; preserve the intentional synchronization boundary.

## Filesystem layout and recovery

The app's user data directory contains the workspace registry (`spaces.json`) and, if configured,
MCP settings (`mcp.json`). Workspace folders contain `workspace.json`, `attachments/`, and
`metadata/` with a writer lock, automatic backups, manual backups, and preserved damaged files.
MCP credentials are outside workspace snapshots and exports.

`WorkspaceStore` serializes writes and checks the expected revision and on-disk fingerprint. It
backs up the prior snapshot, writes a temporary file in the same directory, syncs it, and renames
it atomically. POSIX also syncs the directory. It retains the last 30 automatic checkpoints.
A valid backup can recover an invalid snapshot while preserving the damaged original. Without
a valid recovery source, preserve the folder and report the problem; never reseed it.

The lock contains ownership information. Only a demonstrably stale same-host process is eligible
for automatic recovery. Closing the owning store waits for its queue and releases its own lock.
Third-party folder sync is not collaborative editing; fingerprint checks cannot coordinate another
device's writer or merge divergent documents.

Attachments use generated filenames and registered metadata. Real-path containment rejects
traversal and symlink escapes. A copied file and its reference must be committed through the
existing pipeline. Do not garbage-collect a file merely because the current visible page no longer
uses it: Trash, backups, or reversible crops may still need it.

## Boundaries and current limits

The renderer is sandboxed with context isolation and no Node integration. It loads local app
resources and registered raster attachments, with network access and navigation denied.
Main-process handlers validate both the trusted sender and inputs. See [SECURITY.md](../../SECURITY.md)
before changing these boundaries. Keep native capabilities in the main process and change
`src/shared/api.ts`, `electron/preload.ts`, and `electron/main.ts` together for a new desktop operation.

Snapshots currently have a 64 MiB limit; normal attachment import has a 200 MiB per-file limit.
MCP file tools have a smaller 8 MiB limit. Search is in memory and database views are not
virtualized. These are current implementation constraints, not reasons to introduce a new storage
engine or network service during an unrelated task.
