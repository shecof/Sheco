# Architecture and data ownership

## Source map

| Owner                                                                   | Responsibility                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `electron/main.ts`                                                      | App lifecycle, workspace registry, native dialogs, protocols, IPC, and MCP dispatch          |
| `electron/preload.ts`, `src/shared/api.ts`                              | Fixed, typed renderer-to-main API and event subscriptions                                    |
| `electron/storage.ts`                                                   | Workspace validation on disk, writer ownership, durable saves, recovery, attachments         |
| `electron/mcp.ts`                                                       | Optional authenticated local MCP transport and configuration                                 |
| `electron/jira.ts`, `src/shared/jira.ts`                                | Encrypted device credentials, bounded Jira reads, validated Jira configuration and snapshots |
| `src/state.tsx`                                                         | Live workspace state, serialized saves, transitions, and remote edit coordination            |
| `src/shared/model.ts`                                                   | Validated domain model, hierarchy, search, and database helpers                              |
| `src/shared/document.ts`                                                | Recursive document envelope shared by workspace and template schemas                         |
| `src/shared/documentTemplates.ts`, `dataTools.ts`                       | Bounded template library, literal fields and local data transformations                      |
| `electron/updates.ts`, `src/shared/appUpdates.ts`, `src/appUpdates.tsx` | Device startup preference, shared bounded release checks and semantic version comparison     |
| `src/shared/plugins.ts`, `pluginTools.ts`                               | Validated plugin configuration, curated tool definitions and pure command assembly           |
| `src/shared/mcp.ts`                                                     | MCP schemas, catalog, and pure workspace operations                                          |
| `src/App.tsx`, `src/components/`                                        | Window navigation, page layout, settings, search, and database views                         |
| `src/editor/`                                                           | ProseMirror schema, node views, controls, selection, and media editing                       |
| `src/shared/export.ts`, `image.ts`, `media.ts`                          | Portable representations, crop geometry, and batch media helpers                             |
| `src/i18n.tsx`, `src/shared/i18n.ts`                                    | Language preference, translation context, and Russian strings                                |
| `src/theme.css`, `src/styles.css`                                       | Theme tokens, layout, editor presentation, and print rules                                   |

## Data model

`Page.kind=architecture` owns one bounded `Page.architecture` project, independent of ordinary
rich-document content. `shared/architectureDocument.ts` owns its 8 MiB limit, reference attributes
and search text. `/architecture` creates a normal hierarchy child via the provider and inserts an
`architectureEmbed` atom containing only the child page UUID and fallback label. The node view
resolves live data in the same workspace; missing/trashed targets render unavailable. Removing
an embed retains the page; copying a block retains the reference, while page-tree duplication
clones child diagrams and rewrites embed page IDs. Page/title edits keep project names aligned.
Both embedding and direct opening use ordinary page tabs. The plugin enables creation/editing;
disabled pages and previews remain readable. `plugins.projectArchitecture` retains its old bounded
`projects` library only for snapshot compatibility; no migration of these test projects is required.
Projects have UUIDs, named resources with
stable IDs, site/object UUIDs and directed connections. Connections optionally store startArrow/endArrow (none/arrow) and lineStyle (solid/dashed/dotted). Older `bidirectional: true` links retain two arrowheads through `architectureLinkAppearance`; absent fields remain one-way solid links. SVG and Mermaid preserve direction/style without changing resource accounting or route geometry. A start-only arrow reverses exported Mermaid endpoints because Mermaid does not accept a standalone left-arrow operator. CPU uses cores; RAM/storage use GB.
Optional `labelPosition` is a finite normalized distance along the routed connection (0–1), and
`labelRotation` is a finite angle from −180° to 180°. Missing values retain automatic placement
and orientation. Label metadata participates only in the label cache, never route geometry.
Dragging projects onto the existing route and previews a transform, committing once through the
normal save/history guard; the selected-label rotation handle uses the same preview/commit path
and snaps its preview and stored angle to absolute 15° increments. Existing stored angles remain
unchanged until rotated.
The connection menu has no numeric placement fields. Escape, capture cancellation and stale
projects restore either gesture without saving.
Stationary label clicks retain their native target for double-click editing. Rotated glyph bounds
participate in collision placement and full-scope SVG/raster/print geometry. Mermaid retains its own layout.
The pool belongs to the whole project; every object's allocation counts once, independently
of connections. Site filtering changes displayed usage and diagram membership, never the
global remaining capacity. Negative balances are allowed for planning and shown as warnings.
Limits are 100 sites, 100 groups, 500 objects, 20 resources, 1,000 links per project,
30 custom parameters per object, and 8 MiB per diagram page. The legacy library retains its
30-project/8 MiB bounds. Validation rejects
duplicates, dangling site/resource references, dangling/self/duplicate connections and nonfinite or
negative amounts. Each amount is at most one billion. Deleting a site/object removes its
affected connections in the same immutable update. Allocated resources must be released
before their resource definition can be removed.

Objects optionally store up to 50 individually named `disks` with UUIDs, a GB pool ID and
capacity. Old scalar storage allocations remain valid. `architectureObjectDraft` converts
only the opened form; Cancel never changes disk data and Save preserves resource totals.
`architectureAllocations` adds legacy values and disk capacities by pool for balances and
resource-removal checks. Validation rejects duplicate disk IDs, missing/non-storage pools
and invalid amounts. Moving/reordering objects retains their disks, parameters and links.

Object `siteId` is optional: root objects have no site and may belong to a root group and appear in All sites or No site.
They consume the same global pool. Optional finite positions are bounded to ±1,000,000;
sites/root groups/free objects use world coordinates, nested groups use site-relative coordinates and contained
objects use their group's/site's coordinates. Old snapshots without positions retain default
layout without a migration. `architectureGeometry.ts` owns fixed card/container geometry and its
metadata-independent fingerprint. `architecturePlacement.ts` materializes defaults before spatial
edits, snaps to a 16-unit grid, aligns matching edges, swaps objects/sites and reassigns parents.
Header drags move site/group contents together. Live previews do not save; release samples the
final pointer coordinates and commits once, including a fast release beyond the last movement
sample. Labels and rotation use the same final-sample handling without acquiring pointer capture
after release. Sequential gestures remain independent of pending disk acknowledgements.
Escape/stale context cancels. Duplication assigns fresh object/disk IDs, retains configuration
and independent resource use, and leaves arrows unchanged. Membership changes reset local
placement into a free sibling position; deleting a positioned group rebases its objects into site coordinates.
After structural changes, settle groups, sites and root siblings from the inside out so container
growth and unequal swaps cannot obscure neighbours. The same preparation runs before live
preview and validated draft saves; exact history restores bypass it.

Optional `groups` contain UUID/name/background and an optional site reference; objects optionally reference
`groupId`. Membership accepts servers, databases and websites and must match the group's optional site; groups without a site live on the root canvas.
Existing group fields and older server groups remain valid without migration; changing an object's
type retains its group and local position. Validation rejects dangling,
cross-site or duplicate groups and unrecognized background values. Backgrounds are bounded theme
palette keys, never CSS/markup input. Old snapshots without groups/colors stay readable unchanged.
Moving to another site clears membership; explicit group/site drops reassign/clear it atomically.
Deleting a group retains all objects, allocations and links; deleting a site removes its groups.
Nested diagram frames and Mermaid subgraphs preserve groups and background accents in exports.

Optional `presentation` stores boolean showTitle/showResources/showBalances choices per project;
missing fields retain legacy display defaults. SVG/layout honor title and allocations, Mermaid
honors allocations, and hidden allocations are omitted from output without changing budgets. Native object summary tooltips are omitted. Optional `plugins.projectArchitecture.defaults` uses the same three validated booleans when creating new pages; existing diagrams retain their presentation.
Groups use softer fixed export colors and theme palette/canvas blends in the interactive view.

`architectureDiagramLayout` assigns distinct connection ports and obstacle-aware orthogonal routes
and labels. `architectureRouting.ts` provides a bounded lazy rectilinear search when manual
placement needs more turns; nearby cards shorten port stubs to fit narrow gaps. SVG/image exports
retain manual positions and full negative-coordinate bounds; Mermaid retains topology and groups
but lays them out itself. Live SVG supplies semantic nodes/frame titles and small connection dots, without add
buttons. `ArchitectureDiagram` owns marquee/modifier selection, pointer capture, bulk drop previews,
connection gestures and viewport-contained context menus through Popover. Escape/stale layouts
cancel gestures; mixed object-type selections can enter groups. `moveArchitectureObjects` and
`groupArchitectureObjects` validate and commit immutable bulk operations. Moves retain metadata,
allocations and links. Grouping requires at least two objects belonging to one site or all outside sites, regardless of type.
Direct context creation assigns all types to the target group; root objects can be dragged
into a group, adopting its site.

The architecture canvas uses a session-only SVG viewBox camera, like the Mermaid designer.
Hand/middle-button/held Space pans; ordinary wheel input pans both axes and Ctrl/Meta-wheel
pinch zooms around the cursor. Fit uses both viewport axes, with a 0.1–250% scale range.
Screen-CTM conversion keeps selection, ports, drops and context hit testing in diagram coordinates.
Resize preserves a manually navigated view's scale/center; project/site changes fit the new scope.
Escape/capture cancellation restores an interrupted pan. Camera gestures never write project data
or alter generated export geometry. The viewport clips a fixed-size surface rather than allocating
an oversized scrollable element for large diagrams.

`ArchitectureProperties` and `useArchitectureDraft` retain captured drafts/baselines. Valid edits
commit immediately through the guarded project/save pipeline. Invalid/stale drafts retain text
and block section/selection/page/workspace navigation or closing; explicit Reset reloads current saved values. Clean panels follow external
changes. The designer has only the diagram. The project name sits above the main site-picker heading;
object/site counts are omitted. Tools float inside the canvas at the top center and zoom/fit
at bottom left; fitting reserves clearance for both overlays. Context creation saves valid defaults and opens a
compact property Popover; existing objects use a context/three-dot submenu for General, Resources
or Custom parameters. Each section retains the full captured object draft and has its name field.
Sites/groups use context actions or three-dot SVG controls. Their forms edit name/background
without membership checklists. OS uses one EditablePopoverPicker for suggestions/custom text.
Object menus omit New site and parent deletion; site/group deletion belongs only to that entity. New site appears only on blank canvas, and New group is hidden inside groups. Group selected objects is a top-level selection action, hidden for mixed sites or members already in one group. Multiselection menus omit single-entity editing/creation, and connection menus contain only editing/deletion.
Plain object clicks only select. Point connections save an unlabeled arrow without a form. A single
arrow/label click only selects; double-clicking either opens the compact label editor. Keyboard
Enter/Space still opens it. Selection exposes overlay start/end handles; reattachment
keeps the link ID/label and passes the same guarded save/Undo pipeline. Hovered valid targets and
endpoint handles stay visible. Blue card borders mark explicit object selection only, with
no selected-count text or automatic related-card frames. Object properties omit connection editing; all link
changes use the arrows. Mouse focus has no native outline, while keyboard focus remains visible.
Self/duplicate/blank drops, Escape and stale gestures
preserve the existing connection. Interactive property controls and endpoint overlays do not enter exports. The link popover stacks text, start/end arrowheads, line style and deletion, and closes on valid outside clicks. No object/group/link modal or extra architecture configuration mode is exposed.
The old `plugin:project-architecture` ID remains valid in snapshots but is hidden by `isPluginTabVisible`; App's fallback chooses a visible page. `plugin:project-architecture-settings` opens a reusable settings tab for new-diagram defaults, available from the card while disabled and from the enabled Plugins menu. The
plugin card documents its slash creation command. `ArchitectureSnapshot` renders escaped SVG for
parent previews, disabled pages and full-scope print. Markdown exports readable Mermaid (not a
lossless model replacement); JSON/backups retain the full page-owned diagram. Other plugins retain their reusable configuration tabs.

Undo/Redo holds immutable before/after project snapshots in the designer session, bounded to 30 entries
and 32 MiB. Its fingerprint guard rejects external changes; changing workspace/project resets the
session history. Consecutive text edits coalesce by field/session until blur, Enter or 1.2 seconds
of inactivity; autosave remains immediate. A new action clears Redo. Deletion from selection/context
menus can be restored through this history. Edge-pan/gesture-wheel navigation changes only the
camera, refreshes world-coordinate previews and still commits once on release. Object search
centers a result across site filters; selection highlights incident links without persisting UI state.
Route caches exclude text/style/label-placement metadata; endpoint changes invalidate routes,
while label changes only recompute labels. Each cache holds at most four entries/8 MiB. Reserve ports/parallel segments,
try local obstacle grids before widening, then center labels within their own routes, rotating vertical text. Crowded candidates use bounded collision scoring and retain actual text centered on the route; numeric callouts and gutter legends are omitted in both the canvas and exports. `architectureRouting.ts` caches crossing curves with the routes; a separate overlay paints only the jump strokes and their transparent hit areas. Underpasses stay continuous beneath jump curves, preserving frame colors and nearby horizontal strokes without opaque masks. The jumping line skips only its own straight arc span so the curve renders once. Candidate jumps reserve arrowhead/bend clearance and choose the side clear of neighboring segments. Marker geometry uses the original unbroken route so a path break cannot create extra arrowheads. Label/direction edits never reroute geometry.

`architectureClipboard.ts` validates an 8 MiB versioned JSON snapshot containing selected objects or a group, its resource definitions and required parent context, without links. Paste checks matching resource pool IDs/units and project limits, assigns fresh group/object/disk IDs, finds vacant positions and commits through the normal guarded save/history pipeline. A copied source may have been deleted before pasting. Cross-diagram groups receive a site when needed. Standard copy/paste events preserve native text editing and avoid new filesystem or clipboard IPC.
The project resource budget remains an explicit dialog. Diagram-page deletion uses normal
page Trash; disabling preserves diagrams.

`architectureImageExport.ts` rasterizes generated escaped SVG only, bounded to 16 MP/8192 px per
side and aborted on project/site/presentation changes. Export → Mermaid opens code/copy/.mmd output;
SVG/PNG/JPG download directly from local blobs. Scoped diagrams keep only internal links.
Page-owned diagrams enter workspace backups/full JSON; page Markdown expands them as Mermaid.
CSV remains a database export. The retained legacy library is backup/JSON-only. No network, dependencies,
new filesystem access or IPC methods are added.

The current workspace format has `schemaVersion: 1`, a UUID, and an integer revision. It contains
pages, database schemas, attachment metadata, and UI state. The Zod model checks identities,
hierarchy cycles, missing parents, database membership, and tab validity. The recursive `DocNode`
schema in `shared/document.ts` (re-exported by `model.ts`) validates the JSON envelope without
a workspace/plugin import cycle; full editor grammar is checked separately in
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
`builtinToolsV1` and `builtinToolsV2` definitions are the comparison baselines for their respective revisions. Customized tools, deletions, ordering
and later imports remain unchanged. The stamp is excluded from portable catalog JSON.
Text-parameter `choices` provide suggestions without restricting free input. Tool `outputPresets`
store labels, compatible shells and arrays of command/argument tokens; assembly quotes every
token before joining stages with pipes. Preset selection stays in the renderer session.

`plugins.documentTemplates` defaults to disabled with an empty library. Enabling never adds
examples. Catalog revision 2 retires only unchanged legacy examples; customized/deleted entries
and old enabled/library/tab identities stay readable. The Templates sidebar button appears above
Plugins only while enabled, and opens the reusable app tab. Save as template captures a validated
copy of the chosen page and opens its focused reusable editor. Header and sidebar capture
share one callback that validates the latest live source inside the immutable update. Blank
sidebar context menus reuse root creation actions; blank space also accepts root page drops
without a separate New page row. The format picker omits locale as a separate option while
retaining old locale data and displaying its corresponding concrete selection.

Template bodies share the document envelope, with 100 items, 1 MiB per body, 8 MiB per library,
20,000 nodes and depth 40. Optional legacy `fields` and `databaseDefaults` metadata stays readable
and unchanged, but the interface does not author manual fields or apply property defaults.
`fillTemplate` expands only date/time, with a single creation-time snapshot and bounded format
grammar. Supplied values cannot override date/time or substitute title/custom tokens; these remain
literal text. Adjacent marks form one substitution run, replacements retain the opening mark,
and atoms/blocks end runs. Code annotation ranges map through replacements; link/media/Jira
attributes stay unchanged. Date/Time toolbar buttons retain the draft caret and use editor transactions.
`TemplateDateField.tsx` provides editor-only inline atoms with per-occurrence format pickers.
`templateEditorContent` hydrates existing tokens outside code; `templateStoredContent` converts
atoms back to bounded literal-format tokens before state updates. The saved editor grammar,
workspace schema, exports, search and MCP stay unchanged. Code tokens remain ordinary text
with their existing annotations. Oversized edits remain drafts and are rejected at explicit Save.
The focused editor omits catalog/search and description; legacy descriptions remain readable
but are not shown or copied to new pages.

Creation and explicit library Save validate the editor grammar and local references. Copied pages
stay unchanged. Library drafts retain conflict fingerprints and original legacy metadata; inert
embedded database references cannot edit live records. Root/child/database creation resolves the
current parent/schema inside the normal state/save pipeline and rejects missing/trashed targets.
Templates and created pages remain in ordinary backups and workspace exports.

`templateTransactions.ts` inserts a validated rich document through a ProseMirror Slice and
history boundaries, preserving selected text and surrounding blocks. `/template` replaces only
its captured command range; Ctrl/⌘+Shift+T inserts at the selection end. Code-block carets insert
beside the block to preserve its annotations. The transient modal captures editor identity,
document, page/workspace and remote version; cancelling changes nothing and stale insertion is
rejected. Insertion does not apply template properties or page metadata. Search queries and form
values stay in the renderer session.

Markdown import captures the initiating workspace and requested parent in the renderer. Cancelled
imports create nothing, and missing/trashed parents or a workspace transition reject the result.
The main handler also captures its owning store and checks that scope after asynchronous reads;
attachments are copied through that captured store, never a later workspace's writer.

`plugins.dataTools` holds only enabled state, JSON indentation and CSV delimiter defaults.
Its text draft, selected file bytes, ordered recipe, output and pending-operation sequence live in
a mounted renderer tab and are discarded on close, disable, workspace switch or restart.
`DataTools.tsx` owns the wrapping horizontal recipe band and native grip dragging, plus keyboard
reordering. Drop commits an immutable step order once; cancellation leaves the recipe intact.
`DataTools.tsx` reads only explicitly selected browser Files after checking size, preserves the
prior text draft, and rejects late file reads by request identity. There is no attachment import
or new filesystem IPC. `dataTools.ts` accepts text or raw byte input; SHA/CRC-32/Base64/hex encoding
uses exact bytes, while other operations require valid UTF-8.
Step-local `options` remain optional session data, with literal find/replacement/delimiter/
prefix/suffix, case matching and Unicode form. Every text option is bounded to 1 KiB. Literal
search patterns are escaped internally; user regex/scripts and replacement evaluation are not
supported. Parameter-driven joins/replacements/affixes enforce byte limits while assembling
output. JSON/JSON Lines conversions reuse validated tokens to retain number spellings and duplicate
keys, with 10,000-record and nesting bounds. Line actions recognize CR, LF and CRLF.
Recipes contain at most 32 actions, skip paused steps in place, bound every intermediate result, identify the failed step and stop
between steps when aborted. Debounced edits/settings/recipe changes cancel old runs; request
identity also protects the final output and completion state. Transformations never call IPC or
a network service; only explicit Copy uses the existing clipboard API. Inputs, files and each
intermediate/final output have a 1 MiB cap.
`pluginAppTabs` and `pluginAppEnabled` centrally identify the command, template and data app tabs;
settings IDs remain available while disabled. Legacy snapshots receive compatible defaults.

Update checks use fixed `app-version` / `app-update-check` / `app-update-state` /
`app-update-configure` preload operations and a fixed state event, validated
inputs and the existing trusted-sender gate. `electron/updates.ts` requests only the fixed latest
release endpoint for `shecof/Sheco` through an ephemeral `update-requests` session, omitting
cookies and rejecting redirects, with 10-second / 1 MiB limits. It validates stable release tags
and compares them to `app.getVersion()` semantically. Successful checks cache for five minutes;
concurrent calls share one request and failed checks can retry. No installer or workspace data
is sent; only an explicit external action opens the canonical release page. `AppUpdateService`
owns session state and a revisioned event shared by Settings and the sidebar; the renderer
subscribes before its initial read and ignores stale snapshots. Startup checks default off and
run once when enabled, after launch; enabling applies on the next launch. The device profile's
`updates.json` contains only the strict boolean `checkOnStartup`, with a 4 KiB bounded read,
serialized atomic writes and a close-time flush. Invalid files remain untouched and disabled.
Results stay in memory; a known available release survives a later failed check, while a
successful current/no-release result clears it. Preferences and results never enter workspace data.

`plugins.jira` stores the enabled state and up to 20 connections with unique IDs and normalized
addresses, optional names and authentication types. Single-server snapshots become a connection
with the stable `legacy` ID; snapshots without Jira default to disabled. An explicit empty list
stays empty. Device credentials retain old encrypted records and store independent records per
workspace/server; updating or deleting one token preserves others. Insertion chooses a server,
and a matching issue URL selects its configured server. Refresh resolves the snapshot's address,
never the currently selected settings form. Removing a server rejects its in-flight reads while
retaining offline issue snapshots. The legacy `defaultDisplay` preference remains
readable but new blocks use the detailed schema default; each issue has its own view. `jiraIssue` block atoms and `jiraIssueInline` inline atoms
store the server address, key, display,
summary, status/category, due date and fetch time. The editor owns snapshot transactions and
undo through the existing save queue. `jiraTransactions.ts` converts views with
ProseMirror transactions; bounded `inlineOrigin` metadata rejoins only sentence fragments
created by the conversion, preserving independent paragraphs. Workspace validation
normalizes legacy minimal blocks through `jiraDocument.ts` without mutating input.
Migrated pages receive a newer `updatedAt`; repeated parsing is idempotent and persistence
uses the ordinary save/backup pipeline. HTML parsing accepts legacy minimal wrappers.
Inline Jira snapshots remain consistent across validation, search, clipboard, exports,
outline/code text conversion and MCP. Main-process Jira IPC checks the active workspace and
configured server before and after requests. Jira reads use a separate ephemeral Electron
network session with cookie credentials omitted; renderer network blocking stays intact.
Credential saves and reads require HTTPS except exact loopback hosts; historical block
addresses remain readable. The token field displays a fixed placeholder only for a saved
matching server/authentication/email and never receives the saved secret.
Reads are explicit, use PAT Bearer headers (REST v2) or email/API-token Basic headers
(Cloud REST v3), never follow redirects, and have 15-second / 1 MiB limits. Scoped Cloud
tokens use the fixed Atlassian API gateway after anonymous Cloud ID discovery from the
configured HTTPS `*.atlassian.net` site. The timeout covers both discovery and the issue read.
Tokens and Cloud email use Electron `safeStorage` in
the app profile's atomic `jira-credentials.json`, keyed by workspace and server, outside
workspace exports/backups. Legacy encrypted PAT records remain readable without rewriting them. Credentials are scoped
to workspace, server and authentication type. Status may return the saved email but never a token.
No generic network capability or token read method is exposed.

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

`plugins.filePreview.enabled` defaults to false in older snapshots. Preview tab IDs use `plugin:file-preview:<attachment UUID>` and validate against registered supported attachments while the plugin is enabled. They use the existing UI state/save queue, restore on restart, and close on disable without changing files. `shared/filePreview.ts` owns MIME/extension checks and tab identity. `components/FilePreview.tsx` loads PDF.js lazily and renders only PDF pages onto a canvas; it does not instantiate a PDF scripting/annotation viewer. PDF bytes use the fixed, sender-checked `read-preview-pdf` method (64 MiB, active workspace, enabled plugin, registered ID, contained real path). Raster/video requests use the asset protocol; video is gated by plugin state and streamed with bounded byte ranges by `electron/assetResponse.ts`. Local PDF worker, fonts, CMaps and codecs are packaged by Vite. MCP remains canonical in the device-local `mcp.json`; moving its controls into plugin settings tabs introduces no workspace permission migration.

Attachment activation waits for registration/save and checks workspace, originating tab, navigation generation and latest opening request before activating a preview. Newer navigation wins over a pending open, including a deliberate return to the same page.

Plugin settings IDs are enumerated by `pluginSettingsTabs` in `shared/plugins.ts` and remain valid while disabled. All configuration views use these tabs through the normal state/save queue. Legacy image-preview tabs are retired immutably during workspace parsing while attachment bytes/page data stay intact; malformed/duplicate tab state remains rejected. File preview config adds compatible `pdfFit`/`pdfNavigation` defaults. `PdfPreview.tsx` owns local canvas rendering, bounded outlines, virtualized thumbnails, fit geometry and wheel pinch; `shared/pdfPreview.ts` owns scale calculations. `App.tsx` retains bounded per-open-tab PDF session UI and drops it on tab close/workspace change. Text uses the fixed `read-preview-text` IPC with registered identity, realpath, scope and 4 MiB checks.
