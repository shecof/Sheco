# Editor and block changes

Read [architecture](architecture.md) for state/save ownership and [UI conventions](ui.md) for
popover and interaction requirements. Changes to persisted blocks must preserve their behavior
across editing, validation, search, clipboard operations, and exports.

## Schema and ownership

`documentSchema.ts` provides `documentExtensions()` shared by the editor and MCP validation.
`validateEditorDocument()` combines these extensions with Mathematics, checks node/mark types,
attributes and limits, then uses the real ProseMirror schema. The recursive domain `DocNode`
validator alone does not guarantee a valid editor document.

`ArchitectureEmbed.tsx` is a draggable atom referencing an architecture child page by UUID,
not storing diagram data. Its live escaped-SVG preview opens the child in a page tab. Creation
uses `/architecture` when enabled. Keep its strict attributes, reference validation, backlinks,
search, clipboard, Markdown expansion and print rendering consistent with page-owned diagrams.

`BlockEditor.tsx` coordinates slash/wiki palettes, handle/context actions, editor updates, imports,
math controls, and remote content synchronization. `extensions.tsx` owns custom node views such
as callouts, links, attachments, inline databases, and code. `ImageBlock.tsx` and
`ImageCropDialog.tsx` own image/gallery presentation and cropping. `BlockSelection.ts` owns
selection decorations and group transactions.

`templateTransactions.ts` owns template insertion as one undoable rich-document transaction.
It preserves selected text and surrounding blocks; only an explicit slash range is replaced.
At a code-block caret, insert after that block rather than splitting its text/comments. The shared
template modal keeps a captured document/version/identity and rejects changed pages before dispatch.
Validate the combined editor document, not just the template body. Literal field substitution,
mark preservation and annotation-offset mapping are owned by `shared/documentTemplates.ts`.
The template library adds `TemplateDateField.tsx` only to its draft editor. Inline atoms render
compact format pickers and serialize to existing `{{date:format}}` / `{{time:format}}` text
before entering state. Hydration preserves rich runs and code/atom boundaries; no new persisted
block type is added to the common editor/MCP schema.

Persist content through ProseMirror transactions and the provider. Put toolbar controls outside
editable content, use appropriate `contentEditable={false}` boundaries, and keep placeholder
decorations away from node-view headers. Do not turn a layout fix into a second content store.

## Selection, movement, and menus

- Drag starting in the left/right document gutters selects blocks with accent feedback:
  a light background for text blocks and an outline for other blocks;
  Shift adds, Escape clears. Whitespace within the content remains native text selection.
  Preserve ordinary text selection and interactive controls.
- Any selected handle moves the group in document order. Map positions through transactions;
  ProseMirror positions are not top-level array indices.
- Single handles also use `BlockSelection.ts`'s block-move pipeline. Dropping in a list item's
  text column inserts below the hovered paragraph within that item, without a preparatory blank
  paragraph. Prefer the deepest numbered, bullet or task item; keep its text, siblings and checked
  state. The indented insertion line shows nesting, while the marker gutter places blocks outside
  the whole list. Compute the destination after autoscrolling, and never scroll again on drop.
- Dragging an image directly uses the same block-selection movement pipeline, including gallery
  images, nested list images, and an existing group selection. Ordinary clicks still select one image.
- Group delete, duplicate, and move are atomic actions with meaningful undo. Deleting every block
  must leave a valid editable document. A drop within the selected run should not corrupt content.
  Dropping a group inside one of its selected ancestors is a no-op.
- Copy/cut serializes selected blocks in document order through ProseMirror's clipboard
  serializer, retaining media and block attributes. Cut is one undoable deletion. Ctrl+D/Cmd+D
  duplicates the selected group or current independent block, including children of lists.
- Show insertion markers for block moves and database row/column moves. Block insertion lines are
  3px thick and follow the selected accent in both native and group drag paths.
- Right-click and the drag handle expose block actions near the pointer/trigger. The plus buttons
  above/below a handle appear when its controls are hovered or keyboard-focused and insert an
  empty text paragraph before/after; they do not insert `/`. Keep the controls reachable when
  moving from the grip to either plus, and preserve handle geometry when the plus icons are hidden.
- Nested list blocks retain their own vertical handle position but share the document's horizontal
  gutter, clear of list markers and task checkboxes.
- Blocks in `detailsContent` are independently selectable and draggable, including images and
  galleries inside nested folds. Preserve summaries and sibling content when moving a child out;
  removing the last child must leave valid editable content. Skip hidden child geometry when a
  fold is closed, and keep summary/content wrappers out of independent block selection.

Keep plugin state/decorations synchronized when documents change. Never simulate movement by
reordering DOM nodes or store selection solely as stale DOM rectangles.

## Images, galleries, and files

Accept file drops across the note's content area, not only on a narrow insertion marker. Preserve
all files and their input order. A batch of images can become separate blocks or one gallery;
attachment insertion supports multiple files too. Cancellation must leave existing content intact.

Attachment nodes persist a per-block `display` value: `card` (compatible default), `compact`,
`tile`, or `link`. The hover/focus File view menu changes it through an undoable transaction;
the registered file identity and bytes stay unchanged. Retain the value in clipboard HTML and
workspace JSON, validate it through the editor/MCP schema, and expose it in the MCP catalog.
All views open files through the same attachment API. Search uses the full filename, Markdown
exports an ordinary file link, and print/PDF retains full names while hiding view controls.
Consecutive compact rectangles and square tiles flow horizontally and wrap within their current
container, including list items and collapsible content. They remain independent block nodes in
document order; text, wide cards and links separate the rows.
Dragging the file card itself uses the same block/group movement pipeline as its gutter handle.
Within compact/tile rows, left/right targets show a vertical marker at the hovered card's edge.
The drag preview shows the file card, with a count for groups. Modifier-click adds/removes cards
from the group without opening a file. External file drops must reach the native drop-cursor
plugin's completion handler so its insertion line clears before asynchronous imports finish.

Async imports need a current editor reference, mapped insertion position, and matching page and
workspace identity. Insert a batch as one undoable edit after registering the attachments. Do not
replace an existing selected image just because the drop arrived while it was selected.

Image width is a display setting and keeps proportions. Gallery width belongs to the gallery and
applies to every slide, with compatibility for older per-slide data. Captions and crop settings
belong to individual images. Splitting a gallery retains those attributes.
Enter finishes caption editing and returns focus to the editor; Shift+Enter inserts a newline.
Do not finish a caption while an input method is composing text.

Cropping preserves `originalSrc` and normalized crop geometry, importing a new local PNG rather
than overwriting the source. Reset restores the original. Crop animated images to a still image
only as the current documented behavior. The crop dialog always uses free proportions, without
aspect-ratio presets or explanatory paragraphs. Keep selection reset, dimensions, Cancel and Apply
available. Preserve pointer/keyboard resize and crop interaction.

## Adding a block or persisted attribute

Mermaid diagrams use the `mermaid` atom with `source`, a bounded node-ID-to-coordinate
`positions` map and page `scale` (0.25–2, default 0.65). Older nodes use the compatible scale
default without a storage migration. Scale changes use isolated undoable transactions and draft
Apply preserves the scale. It is separate from the canvas camera. `shared/diagram.ts` owns
validation and the lossless subset supported by the
visual flowchart editor; richer syntax and other Mermaid types retain their code editor. Rendering
is bundled and local, with strict Mermaid security and sanitized SVG in `diagramRendering.ts`.
`DiagramCanvas.tsx` owns the draft canvas, tool palette, connections and anchored element popovers;
`DiagramPreview.tsx` renders saved blocks and code previews. Keep the canvas viewport stable while
moving nodes. Coordinates are bounded to ±10000; negative positions support placement above/left
of an automatic layout and must remain visible in saved previews and exports. Straight-axis and
orthogonal connection routing is shared by the canvas and saved previews, including nearly aligned
blocks and shape boundaries, without mutating stored positions. Routing tries alternative cardinal
attachment sides and outside detours to avoid intervening blocks. Ordinary connections use Mermaid
`---`; arrows use `-->`. Manual placement modifies the generated diagram SVG, never the
ProseMirror document DOM. Applying a draft uses one existing
editor transaction and refuses a stale node version. Markdown fences preserve code; only workspace
JSON and clipboard HTML preserve manual coordinates and scale. Print/PDF honors page scale and
constrains oversized diagrams to the printable width. Keep the shared schema, MCP example, search,
Markdown import/export and print rules consistent.

1. Extend the actual editor node/mark schema and defaults; preserve existing snapshots.
2. Add or adjust slash insertion and node controls where relevant.
3. Update shared validation and the MCP catalog/examples so agents can author the same feature.
4. Check search text extraction, Markdown/CSV where applicable, PDF/print rules, and portable
   attachment/link handling. Audit constructors, seed data, and import paths.
5. Choose focused unit and desktop coverage from the [testing matrix](testing.md).

Code language selection and settings use compact anchored popovers. Titles, line numbers, and
`collapsedByDefault` are persisted attributes; gutter numbers are not part of code text. Folding
must not discard content. PDF/print exposes complete code and all gallery slides with captions,
while hiding editing controls.

Tab inserts a literal tab character at the code caret, or replaces a selection confined to that
code block. It also works in code inside a list item or table cell. Keep the edit in the existing
transaction pipeline so comments map through it and undo restores the original code. Preserve
ordinary focus traversal, list indentation and table navigation outside code.

Code comments live in the code block's `comments` attribute, with IDs, text, and zero-based
half-open UTF-16 ranges relative to its code text. `CodeComments.ts` maps ranges through text
transactions and removes a comment when its entire range is deleted. Highlights are decorations,
not code text or marks. Show explanations in a compact anchored popup on hover or click; keyboard
activation must not insert text. Keep the popup reachable for editing, reanchor when moving between
ranges, size short notes to their content, and show all notes at an overlap. A selection confined
to one code block exposes a comment action in both its header and block menu. These triggers share
the `codeCommentsKey` transaction request and the same node-view draft. Full explanations remain
visible in PDF/print.
Preserve comments in clipboard HTML, search, Markdown and PDF/print;
validate their ranges through the shared editor schema. Older blocks default to an empty list.

Modifier-clicking images or block handles adds/removes individual blocks from the selection.
Selected images/galleries can be combined into one slider in document order without losing
captions or crop sources. List child blocks can be selected and deleted independently; actions
must retain the list's required leading paragraph and unselected siblings. Clipboard HTML carries
image captions/crops and every gallery image with its shared width.

Image toolbars must remain reachable across the gap above a picture without first selecting it.
Gallery toolbars sit inside the picture and need no bridge over image content. Crop outlines and
corner controls must remain visible on both light and dark source images, including a full-frame
selection at the stage edges.

Workspace JSON is the lossless format. Markdown provides readable custom block representations;
do not promise exact round trips or silently erase unsupported attributes during an export/import.

Simple tables use the existing cell/header `align` attribute (`left`, `center`, `right`, or the
legacy null default). `TableAlignment.ts` applies alignment to entire selected columns using
the table map, retains merged cells and widths, and lets inserted rows inherit alignment. Keep
headers, body cells, undo, validation, Markdown markers, and printed tables consistent.

`TableControls.tsx` tracks hovered/selected tables from editor transactions and measured geometry.
Controls sit outside editable content: compact auto-width/header settings above the table, axis
handles with alignment/reorder/delete menus, and append strips on the last row/column. `TableActions.ts`
uses the existing cell widths/header node types and ProseMirror axis movement; merged cells move
as connected groups. Automatic width clears manual column widths. Each change must undo in one
step, and control geometry must follow scrolling/resizing without stealing text selection.
Axis handles follow the caret's cell rather than pointer hover. Enabled first-row/first-column
headers have no axis handle and stay fixed during body-axis reordering, including merged groups.
Keep edge controls reachable across their gaps; leaving a cell for its controls must retain hover.
Keep compact document spacing above tables; the settings toolbar overlays the preceding area
only while active. Table/ordinary block controls have the same measured width, with the table's
buttons translated outward to clear axis controls, so transitions do not shift the next handle.

`FilledTableView.ts` keeps manually sized tables at least as wide as their frame, with the last
column absorbing spare space and preceding columns retaining their widths. Wider tables keep
horizontal scrolling. Layout does not rewrite saved widths; resizing the stretched column starts
from its displayed width. Automatic width must also clear stale DOM column widths.

`FindReplace.tsx` owns literal page-content search, match decorations, case sensitivity and
single/all replacement transactions. Search spans adjacent text marks but never crosses atoms
or block boundaries. Replacements retain surrounding formatting and remain one undoable edit;
code-comment ranges map through the existing plugin. Ctrl/Cmd+F opens search; Ctrl+H or
Cmd+Shift+H opens replacement, also available from Page options. Keep highlights out of print.
