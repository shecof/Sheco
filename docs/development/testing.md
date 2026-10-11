# Verification and regression work

Choose checks based on the behavior changed. Prefer a focused existing suite or a meaningful
regression case over tests that simply mirror implementation details. Reversible copy/style edits
do not automatically need new unit tests. Persistence, concurrency, imports, and security need
tests that exercise their failure paths.

## Existing checks

| Change                                                                                                       | Relevant checks                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| TypeScript or shared API                                                                                     | `npm run typecheck`                                                                                                     |
| Model, hierarchy, search, database helpers                                                                   | `npm test -- tests/model.test.ts`                                                                                       |
| Save queue, recovery, locks, attachment containment                                                          | `npm test -- tests/storage.test.ts`, then `test:e2e` for desktop flow                                                   |
| Markdown/CSV/export behavior                                                                                 | `npm test -- tests/export.test.ts`; media/image suites when affected                                                    |
| Image geometry and crops                                                                                     | `npm test -- tests/image.test.ts`, `npm run test:images`                                                                |
| Batch files, sliders, captions, languages, code titles/gutters                                               | `npm test -- tests/media.test.ts`, `npm run test:media`                                                                 |
| Filename search, caption caret, outline jumps and Mermaid diagrams                                           | `npm test -- tests/diagram.test.ts tests/model.test.ts tests/mcp.test.ts`, `npm run test:knowledge`, `npm run test:mcp` |
| Attachment views, file identity/opening, clipboard and persisted display                                     | `npm test -- tests/media.test.ts tests/mcp.test.ts`, `npm run test:attachments`                                         |
| Code Tab, nested list/cell keyboard scope, comment mapping and undo                                          | `npm run test:remarks`, `npm test -- tests/code-comments.test.ts`                                                       |
| Title wrapping/focus, clipboard media, image dragging/caption keys, list gutters, comment menus/popups       | `npm run test:remarks`, `npm test -- tests/code-comments.test.ts`, `npm run test:blocks`                                |
| Marquee selection, group moves/deletion, direct list drops, children of collapsible blocks, right-click      | `npm test -- tests/block-selection.test.ts`, `npm run test:blocks`                                                      |
| Mixed block copy/cut/paste, page find/replace, Ctrl+D, file card dragging, table transitions, sidebar resize | `npm test -- tests/find-replace.test.ts tests/block-selection.test.ts tests/model.test.ts`, `npm run test:improvements` |
| Database interactions, popovers, revised block controls                                                      | `npm run test:review`                                                                                                   |
| Full-height database cell editing, checkbox hit areas, automatic timestamps and retained drafts              | `node scripts/database-cell-review.mjs`, `node scripts/database-editing-review.mjs`, `npm run test:review`              |
| Database cell focus without page/table scroll jumps, including partially visible multiline cells             | `SHECO_CELL_CASE=scroll node scripts/database-cell-review.mjs`, `node scripts/database-cell-review.mjs`                 |
| Full-height Name cell editing, focus/drafts, opening pages and drag-handle separation                        | `SHECO_CELL_CASE=name node scripts/database-cell-review.mjs`, `npm run test:review`                                     |
| Database filter/sort pickers, nested property menus, sidebar page dragging and saved hierarchy               | `node scripts/database-sidebar-review.mjs`                                                                              |
| Live database column resizing, saved Name width, multiline cells, value choices and quick header filters     | `npm test -- tests/model.test.ts`, `node scripts/database-editing-review.mjs`                                           |
| Intrinsic tag-column minima, narrow legacy widths, larger Name minimum and fixed-width database pages        | `node scripts/database-widths-review.mjs`, `node scripts/database-editing-review.mjs`, `npm run test:reading`           |
| Simple table column alignment, merged cells, undo, Markdown markers                                          | `npm test -- tests/table-alignment.test.ts`, `npm run test:reading`                                                     |
| Simple table controls, headers, widths, row/column reordering and gutter selection                           | `npm test -- tests/table-actions.test.ts`, `npm run test:tables`, `npm run test:blocks`                                 |
| MCP operations, actual schema, permissions, live edits                                                       | `npm test -- tests/mcp.test.ts`, `npm run test:mcp`                                                                     |
| App lifecycle, IPC, broad state changes                                                                      | `npm run test:e2e` plus affected specialized suites                                                                     |
| Plugin toggles, command assembly, custom tool catalog and portable JSON                                      | `npm test -- tests/plugins.test.ts`, `npm run test:plugins`, `npm run test:e2e`                                         |
| Reading preferences, accents, outline, clipboard, PDF page background                                        | `npm run test:reading` (PDF raster check requires `pdftoppm`)                                                           |
| Direct page-export menus, native-save cancellation, Trash emoji alignment/restoration                        | `npm run test:reading`, `npm run test:e2e`                                                                              |
| Broad source changes or release candidate                                                                    | `npm run check` and relevant desktop suites                                                                             |
| Documentation only                                                                                           | Check local links, cited commands/source claims, and targeted Prettier formatting                                       |

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

Inspect failures instead of weakening assertions to get green output. Add a focused regression
test when the defect warrants one; include its failure before the fix when practical. Once checks
pass, broaden them only when the change or an unresolved concern justifies the extra run.

For meaningful behavior changes, include the actual checks, observed behavior, and platform
limits in the pull request or release notes. Link to CI results and include screenshots made from
synthetic fixtures where useful. Do not use old screenshots, earlier test counts, or an existing
installer as proof for new code. Documentation-only changes need link and formatting checks.
