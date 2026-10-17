# Verification and regression work

Choose checks based on the behavior changed. Prefer a focused existing suite or a meaningful
regression case over tests that simply mirror implementation details. Reversible copy/style edits
do not automatically need new unit tests. Persistence, concurrency, imports, and security need
tests that exercise their failure paths.

## Existing checks

Architecture diagrams: `npm test -- tests/architecture-document.test.ts tests/project-architecture.test.ts tests/architecture-placement.test.ts tests/plugins.test.ts`,
then `npm run test:architecture`, `node scripts/architecture-dense-review.mjs`,
`npm run test:mcp` and `npm run test:e2e` on freshly compiled output.
The current architecture page suite owns a new isolated profile. It covers slash creation of a
child page and preview, independent page-owned diagrams, sidebar opening/duplication, live parent
previews, compact General/Resources/Custom parameters menus, invalid section/page navigation,
resource/disk/OS/parameter autosave (including sequential disk edits and invalid-name
correction without a stale baseline), Undo/Redo, camera-only movement, single-click arrow selection
with unobstructed endpoint dragging, double-click label/path editing and keyboard label editing,
SVG/Mermaid/PNG/JPG exports, print previews, disable preservation, both themes/languages,
narrow containment and restart. It also checks the project/scope heading hierarchy without counts,
canvas-contained toolbar placement, keyboard zoom, toolbar wheel isolation, one OS combobox for
filtered/keyboard suggestions and custom text, conditional grouping/context actions, group forms
without membership checklists and cross-site server/database/website drag/drop with exact Undo. It verifies mixed selection
grouping, creating any type inside a group, changing a grouped type, membership after restart,
and selection-only card frames without selected-count text. Evidence is under `test-results/architecture-pages/`.

`node scripts/architecture-dense-review.mjs` checks label presence and keystroke-to-diagram latency
on a page with 500 objects/1000 links. Its 500 ms mean latency budget is a local regression gate,
not a universal device guarantee. Evidence remains under `test-results/architecture-audit-fixes/`.
Unit cases cover grid positions, expansion/swaps, moving grouped children, detached objects,
capacity accounting, routing and legacy snapshot validation. The old `architecture-review.mjs`,
`architecture-placement-review.mjs` and `architecture-audit-review.mjs` scripts target the retired
library/project selector; they are historical reproductions, not current page-workflow checks.

| Change                                                                                                                 | Relevant checks                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript or shared API                                                                                               | `npm run typecheck`                                                                                                                                                          |
| Startup update preference, shared status, GitHub release links and device persistence                                  | `npm test -- tests/app-updates.test.ts`, `node scripts/update-review.mjs`, `npm run test:e2e`                                                                                |
| Model, hierarchy, search, database helpers                                                                             | `npm test -- tests/model.test.ts`                                                                                                                                            |
| Save queue, recovery, locks, attachment containment                                                                    | `npm test -- tests/storage.test.ts`, then `test:e2e` for desktop flow                                                                                                        |
| Markdown/CSV/export behavior                                                                                           | `npm test -- tests/export.test.ts`; media/image suites when affected                                                                                                         |
| Image geometry and crops                                                                                               | `npm test -- tests/image.test.ts`, `npm run test:images`                                                                                                                     |
| Batch files, sliders, captions, languages, code titles/gutters                                                         | `npm test -- tests/media.test.ts`, `npm run test:media`                                                                                                                      |
| Filename search, caption caret, outline jumps and Mermaid diagrams                                                     | `npm test -- tests/diagram.test.ts tests/model.test.ts tests/mcp.test.ts`, `npm run test:knowledge`, `npm run test:mcp`                                                      |
| Attachment views, file identity/opening, clipboard and persisted display                                               | `npm test -- tests/media.test.ts tests/mcp.test.ts`, `npm run test:attachments`                                                                                              |
| Code Tab, nested list/cell keyboard scope, comment mapping and undo                                                    | `npm run test:remarks`, `npm test -- tests/code-comments.test.ts`                                                                                                            |
| Title wrapping/focus, clipboard media, image dragging/caption keys, list gutters, comment menus/popups                 | `npm run test:remarks`, `npm test -- tests/code-comments.test.ts`, `npm run test:blocks`                                                                                     |
| Marquee selection, group moves/deletion, direct list drops, children of collapsible blocks, right-click                | `npm test -- tests/block-selection.test.ts`, `npm run test:blocks`                                                                                                           |
| Mixed block copy/cut/paste, page find/replace, Ctrl+D, file card dragging, table transitions, sidebar resize           | `npm test -- tests/find-replace.test.ts tests/block-selection.test.ts tests/model.test.ts`, `npm run test:improvements`                                                      |
| Database interactions, popovers, revised block controls                                                                | `npm run test:review`                                                                                                                                                        |
| Full-height database cell editing, checkbox hit areas, automatic timestamps and retained drafts                        | `node scripts/database-cell-review.mjs`, `node scripts/database-editing-review.mjs`, `npm run test:review`                                                                   |
| Database cell focus without page/table scroll jumps, including partially visible multiline cells                       | `SHECO_CELL_CASE=scroll node scripts/database-cell-review.mjs`, `node scripts/database-cell-review.mjs`                                                                      |
| Full-height Name cell editing, focus/drafts, opening pages and drag-handle separation                                  | `SHECO_CELL_CASE=name node scripts/database-cell-review.mjs`, `npm run test:review`                                                                                          |
| Database filter/sort pickers, nested property menus, sidebar page dragging and saved hierarchy                         | `node scripts/database-sidebar-review.mjs`                                                                                                                                   |
| Live database column resizing, saved Name width, multiline cells, value choices and quick header filters               | `npm test -- tests/model.test.ts`, `node scripts/database-editing-review.mjs`                                                                                                |
| Intrinsic tag-column minima, narrow legacy widths, larger Name minimum and fixed-width database pages                  | `node scripts/database-widths-review.mjs`, `node scripts/database-editing-review.mjs`, `npm run test:reading`                                                                |
| Simple table column alignment, merged cells, undo, Markdown markers                                                    | `npm test -- tests/table-alignment.test.ts`, `npm run test:reading`                                                                                                          |
| Simple table controls, headers, widths, row/column reordering and gutter selection                                     | `npm test -- tests/table-actions.test.ts`, `npm run test:tables`, `npm run test:blocks`                                                                                      |
| MCP operations, actual schema, permissions, live edits                                                                 | `npm test -- tests/mcp.test.ts`, `npm run test:mcp`                                                                                                                          |
| App lifecycle, IPC, broad state changes                                                                                | `npm run test:e2e` plus affected specialized suites                                                                                                                          |
| Plugin toggles, command assembly, custom tool catalog and portable JSON                                                | `npm test -- tests/plugins.test.ts`, `npm run test:plugins`, `npm run test:e2e`                                                                                              |
| Document templates, data transformations, plugin categories and GitHub version checks                                  | `npm test -- tests/document-templates.test.ts tests/data-tools.test.ts tests/app-updates.test.ts`, `npm run test:document-tools`, `npm run test:plugins`, `npm run test:e2e` |
| Automatic date/time templates, capture, creation, legacy compatibility and insertion/undo                              | `npm test -- tests/document-templates.test.ts tests/template-insertion.test.ts`, `npm run test:templates`, `npm run test:document-tools`                                     |
| Local file previews, attachment tabs, PDF byte limits, video ranges, sidebar import                                    | `npm test -- tests/file-preview.test.ts tests/storage.test.ts`, `npm run test:file-preview`, `npm run test:attachments`, `npm run test:e2e`                                  |
| Jira Cloud/PAT settings, encrypted credentials, issue blocks, manual refresh, stale replies and offline snapshots      | `npm test -- tests/jira.test.ts tests/jira-inline.test.ts tests/mcp.test.ts tests/export.test.ts`, `npm run test:jira`, `npm run test:jira-inline`, `npm run test:e2e`       |
| Multiple Jira servers, legacy migration, independent tokens, connection removal and selected-page PDF with hidden tabs | `npm test -- tests/jira.test.ts`, `node scripts/settings-export-review.mjs`, `npm run test:reading`                                                                          |
| Reading preferences, accents, outline, clipboard, PDF page background                                                  | `npm run test:reading` (PDF raster check requires `pdftoppm`)                                                                                                                |
| Direct page-export menus, native-save cancellation, Trash emoji alignment/restoration                                  | `npm run test:reading`, `npm run test:e2e`                                                                                                                                   |
| Broad source changes or release candidate                                                                              | `npm run check` and relevant desktop suites                                                                                                                                  |
| Documentation only                                                                                                     | Check local links, cited commands/source claims, and targeted Prettier formatting                                                                                            |

`npm run build` must precede desktop suites after source changes: those scripts launch the actual
Electron app from compiled output, not Vite or TypeScript source. `npm run check` already includes
the build and unit suite, so do not repeat them without a reason. A build warning and a failed check
are different outcomes; report unresolved warnings accurately.

## Fixture boundaries

The integration scripts under `scripts/` use temporary folders with their own `SHECO_DATA_DIR`.
Keep native-dialog, clipboard, and protocol stubs inside the test process. Never replace the user's
clipboard, enable MCP in the user's preview, or manipulate normal Documents workspaces to test a
feature. Tests should own every app instance and folder they mutate.

Screenshots go into `test-results/` and suite subdirectories. This directory also holds the
persistent design preview, so never clean the whole directory. Removing only a known disposable
fixture or a suite's generated screenshots is different from removing the preview workspace.

Use `fs.mkdtemp` for new fixtures and a free-port probe for MCP tests; the default MCP port may
already belong to another process. Close the fixture app gracefully, including on failures.
Preserve failure evidence needed for diagnosis and do not delete another process's writer lock.

## What to verify

- Exercise the original trigger, including pointer/keyboard behavior and relevant page types.
- For state changes, wait for an exact saved status (`\bsaved\b`, not a substring matching
  `unsaved`). Restart when verifying disk persistence, preferences, or recovery.
- For async edits/imports, test typing or switching contexts while work is pending. Confirm that
  stale responses do not overwrite newer content or land in a different page/workspace.
- For block actions, verify order, retained attributes, undo, and a valid document after deleting
  all blocks. A screenshot alone cannot prove transaction or persistence correctness.
- For UI fixes, inspect both light/dark and English/Russian when affected, as well as narrow
  windows, scrolling, viewport edges, and an inline database where clipping is a risk.
- For MCP, use the real SDK client. Include stale versions, read-only visibility, authentication,
  key rotation, workspace switching, remote edits followed by local typing, and save persistence.

`scripts/smoke.mjs` supports `SHECO_TEST_EXECUTABLE` for a packaged executable. A source-app run
does not prove that packaging, signing, or another operating system works. CI currently runs the
broad smoke suite, not every specialized review suite.

## Evidence and reporting

`test:document-tools` runs `templates-review.mjs` and `data-recipes-review.mjs` sequentially
in separate isolated profiles. The template suite verifies restored settings and the sidebar
button above Plugins, header/sidebar capture, equivalent Pages/blank-space menus, focused
editing without catalog/search/description, inline per-field formatting and undo, caret placement, explicit Save,
unchanged original pages and retained legacy fields/defaults, automatic creation-time snapshots,
root/child/database pages, literal non-date/time tokens, code annotation mapping, disabled manual
forms, insertion cancellation, disable/re-enable, restart and light/English plus narrow dark/Russian.
Screenshots and verification JSON are in `test-results/templates/`. `test:templates` runs that
suite independently. Unit tests retain legacy metadata/schema compatibility and verify date/time
substitution across marks without crossing atoms/blocks, ignored override values and one-step
rich-document insertion/undo in nested lists and annotated code. Draft atom coverage verifies
per-occurrence formats, mark inheritance, code preservation, literal serialized output and
rejection of invalid formats without rewriting the original template.

The data suite verifies all 45 action options, parameters, Unicode/JSON Lines/CRC behavior,
horizontal recipes, native/keyboard ordering, pause/resume, visible removal, exact-byte files,
file/run cancellation, session discard, settings, restart and newer-release checks. It also
checks restored template entry points leave the saved library/tab identities intact in both
languages. Evidence is in `test-results/data-recipes/`.

`node scripts/update-review.mjs` wraps the compiled main process in a temporary test app, with
network/external-opening stubs registered before startup. It checks the default-off preference,
enabling/disabling across restart, one shared in-flight check, cache reuse, strict IPC preference
validation, both canonical release buttons, sidebar placement, failed-check retry and current
version without a notice. Original fixture pages remain unchanged and preferences stay outside
workspace snapshots. English/light and Russian/dark narrow screenshots and verification JSON
are in `test-results/updates/`. No live GitHub requests or browser navigation occur in this suite.

Inspect failures instead of weakening assertions to get green output. Add a focused regression
test when the defect warrants one; include its failure before the fix when practical. Once checks
pass, broaden them only when the change or an unresolved concern justifies the extra run.

`node scripts/plugin-settings-review.mjs` focuses on the five configuration cards with inline
settings: file preview, architecture, data tools, Jira and MCP. It checks header separation,
compact architecture rows, a single-line MCP description and contained header switches in both
themes/languages at 1280px and 980px. It disables architecture through its settings header,
restarts, verifies read-only diagram access, re-enables with the keyboard and restarts again.
Pages, diagrams, defaults and other plugin settings must survive unchanged. Evidence is in
`test-results/plugin-settings/`; MCP stays disabled in this isolated fixture.

`node scripts/settings-export-review.mjs` uses an isolated profile, two synthetic Jira endpoints
with different tokens and a temporary MCP port. It verifies legacy settings, duplicate rejection,
server/form draft switching, URL selection, snapshot-specific refresh, restart without fetching,
stale reads on connection removal and independent credential deletion. It exports through the
native page menu with mounted tool/settings tabs, then extracts every PDF page to verify that
only the selected page printed. It checks setting borders/heading spacing and semantic MCP
readiness in light/English and narrow dark/Russian. Evidence is in `test-results/settings-export/`.

For meaningful behavior changes, include the actual checks, observed behavior, and platform
limits in the pull request or release notes. Link to CI results and include screenshots made from
synthetic fixtures where useful. Do not use old screenshots, earlier test counts, or an existing
installer as proof for new code. Documentation-only changes need link and formatting checks.

`test:file-preview` uses a fresh isolated profile with an eight-page synthetic PDF with internal/external outline entries, plain text, retired-image and canvas-recorded WebM fixtures. It verifies disabled/external fallback, fit-to-height, compact editable page controls including keypad Enter, horizontal zoom controls clear of the fitted page, icon-only outline/virtualized thumbnails, continuous nonblank pinch frames, slow edge holding, magnified-page arrival overshoot/momentum protection in both directions including exact-edge landing, strong multi-page wheel input during rasterization, weak momentum suppression and previous-page bottom landing, retained PDF session UI, escaped text with contained unwrapped horizontal scrolling and external-only image opening, video playback, tab reuse/restart/disable, workspace and symlink rejection, cancellation after newer navigation while saving, slash-only collapsed commands, separate settings tabs with retained drafts and persistence, sidebar Markdown import and both languages/themes. PDF.js resources must be included in the compiled build. The file-preview, inline-Jira, plugin and smoke suites accept `SHECO_TEST_MAIN` for an isolated compiled build; smoke still prioritizes `SHECO_TEST_EXECUTABLE` for packaged apps. Do not rebuild a bundle while a desktop suite is using it; run GUI suites sequentially to avoid focus interference.

`node scripts/architecture-controls-review.mjs` checks compact architecture/Mermaid controls,
mouse selection followed by Delete/Backspace, one-step Undo of object/group paste, independent IDs,
two-way connection persistence, new-diagram defaults, icon headers, command disclosure titles,
small empty-screen logo surfaces, both themes/languages and narrow containment. Shortcut tests use
fixture-local standard clipboard events with real Ctrl/Cmd key presses; the OS clipboard remains
untouched. Evidence is in `test-results/architecture-controls/`.

`node scripts/architecture-label-review.mjs` measures actual SVG text and background bounds for
short/long numbers, wide/narrow Latin letters, Cyrillic, CJK and emoji on horizontal and rotated
connections. It checks equal 8-unit side padding while editing, after zooming, in embedded previews
and downloaded SVG, plus light/English and narrow dark/Russian views. It also checks that label
edits retain arrow paths and that temporary measurement nodes are removed. Synthetic measurements
and a full-size export crop are in `test-results/architecture-labels/`.
The same suite checks real pointer label dragging, Escape/pointer cancellation, one-step
Undo/Redo, pointer/keyboard rotation handles with exact 15° snapping (including zero and ±180°),
compact menus without numeric placement fields,
rotated previews/exports and persistence through the main-process writer and a complete restart.

`node scripts/architecture-crossings-review.mjs` renders synthetic route fixtures through the
shared SVG exporter in Electron with the actual theme/selection styles. It checks clearance near
arrowheads, close parallel routes, ordinary/selected strokes in both themes, and unchanged colored
background pixels next to a jump and uninterrupted underpass strokes. Marker paths remain continuous, retaining exactly the original
start/end heads. A native architecture-page fixture verifies clicking the curve selects its own
connection, followed by Delete and Undo. Fixture SVGs, screenshots and pixel checks are in
`test-results/architecture-crossings/`. Run the controls suite for native arrow interaction and
the dense suite for geometry-cache editing performance.

`node scripts/architecture-save-review.mjs` checks native fast object/label drops where the
release position is beyond the last movement sample, including releases without a drag move.
It holds the first actual save acknowledgement while accepting further gestures, releases it
during a later drag, and verifies visible/live positions, metadata, one-step Undo/Redo, final disk
content and a full restart. Only the fixture's IPC save reply is delayed; the original validated
storage handler still performs every write. The fixture window stays hidden with rendering
unthrottled, avoiding native pointer interference from other open previews. Evidence is in
`test-results/architecture-save/`.

`node scripts/architecture-context-review.mjs` checks the context menu for server/database/website
objects, site/group frames, connections, blank canvas and compatible/incompatible multiselections
in both themes/languages at wide/narrow widths. It verifies top-level grouping, parent deletion
isolation, no nested-group creation, root-group save/Undo/Redo/filtering/SVG/Mermaid/restart and
removal retaining members/links. It also measures the property close button's equal top/right
spacing. Synthetic screenshots and results are in `test-results/architecture-context/`.
