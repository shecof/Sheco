# Product and UI conventions

These conventions describe the current interface. Discuss changes to product direction before
reworking them; avoid restoring superseded designs from old screenshots or unused strings.

## Appearance and navigation

Each architecture is a child page with a live note preview, opened by `/architecture`. Hide the
legacy architecture library tab while preserving old snapshot data. Architecture settings remains a reusable tab for workspace defaults applied only to new diagrams. Show the project
name in the small upper line and the site picker (All sites initially) as the main heading;
omit object/site totals. Place selection/hand/Undo/Redo in a floating top-center toolbar and
zoom/fit at the bottom left inside the canvas, clear of fitted content. Toolbar input must not
start canvas gestures or change selection; keep wheel events contained.
Omit the site rail and static object/group/site/Mermaid buttons. Create object is a hover
submenu using the existing BlockSubmenu corridor, keyboard navigation and viewport flipping.
Portal pointer-position anchors to the document body so container-query containment cannot offset them. Automatic camera fitting on resize must retain a valid open context menu. Order context actions as Create (server/database/website/group), Edit properties, Duplicate and Delete. Use matching 12px text/padding in parent and child action menus, keep keyboard focus feedback without a permanent mouse focus fill, and open only one sibling submenu at a time. Open directly to the diagram and omit the Objects view. Right-click the canvas/site/group for
immediate creation. Context → Edit properties and three-dot frame/node controls open compact
anchored autosaving property popovers; ordinary node clicks only select. Keep CPU/RAM immediate,
add disks individually and split General/Resources/Custom parameters. Edit connections at arrows only. OS suggestions use a compact
editable combobox with bounded suggestions, accepting a custom OS in the same field. Reuse
PopoverPicker / EditablePopoverPicker; omit persistent helper paragraphs.

Support marquee/modifier selection, context grouping/deletion, bulk moves, visible destinations,
Escape cancellation and canvas Undo. Groups contain servers, databases and websites from one site or directly on the root canvas and preserve them
when removed; group frames have soft accents and no add buttons. Group properties show only
name/background/deletion, with membership edited on the canvas. Hide unavailable grouping
actions, and show New site only on blank canvas. Keep Group selected objects outside Create object. Omit single-object editing/creation from multiselection menus. Site/group deletion appears only for the clicked frame, never its children or a selection; connections show only editing/deletion. Hide New group within a group because groups cannot be nested. Small boundary dots create links
directly without opening forms. A single click selects an arrow and exposes its endpoint handles;
double-clicking its path or label opens the focused compact label input. Enter/Space remains
available for keyboard editing.
Selected arrows expose draggable start/end handles; highlight valid hovered connection targets.
Blue card borders mean explicit selection only; omit the selection count and related-card frames. Preserve link ID/label on reattachment; reject self/duplicate/blank drops and cancel
with Escape. Omit endpoint dropdowns and the connection property panel. Keep invalid/stale drafts visible and block
navigation until corrected/reset. Theme tokens and fixed export palettes retain readable accents.
Display settings persist diagram title, object allocations and resource balance independently per
project. Export → Mermaid opens Copy/Download; SVG/PNG/JPG download directly. Use a free, clipped
canvas with Hand/middle-button/held Space panning, wheel navigation and cursor-anchored pinch or
Ctrl/Meta-wheel zoom. Keep Select for marquee/object editing, percentage for fitting both axes,
and a 0.1–250% camera scale. Retain scale/center on property-panel resize; camera changes stay in
the session and exports include the whole scope. Contain context menus within the available viewport.
Project resources keeps an icon and text; search/export/display settings use matching outlined icon buttons with centered, unclipped SVGs. Omit the header divider. Architecture and Mermaid canvas tools use 28px buttons and compact panels. Native object hover summaries are omitted; accessible object names remain. Architecture defaults use the shared setting-switch controls. Other plugin configuration still uses settings tabs.

Center connection labels in a line break on their own route, rotating them on vertical segments. Measure their rendered SVG glyph bounds and retain 8 diagram units of horizontal padding on both sides, independent of text length, glyph width and zoom; previews and SVG/raster exports share these bounds. Use small jump curves over continuous underpassing strokes and no opaque backdrop at crossings; always retain text on its own route, including crowded corridors, without numbered legends. The connection popover uses stacked text, independent start/end arrowhead pickers, a solid/dashed/dotted line picker and deletion; outside clicks close valid drafts. Delete/Backspace removes the selected arrow while retaining canvas focus. Ctrl/⌘+C/V copies/pastes objects or a selected group through standard clipboard events; text fields keep native editing. Copies have independent IDs/resources and no arrows.
Drag a label along its own route to place it manually. A selected labeled arrow exposes a small
rotation handle above the label; dragging and arrow keys on the focused handle both snap to
absolute 15° increments. Omit numeric placement/rotation fields and their reset action from the menu.
Moving endpoints keeps a manual label at the same relative distance. Escape/capture loss cancels
either gesture, and Undo/Redo treats a completed gesture as one change. Fast object/label drops
settle at the release coordinates even when no final pointermove was delivered; disk saving does
not gate the next gesture. Retain single-click
selection and double-click text editing.

Allow root objects without a site, including context creation on blank canvas and a No site filter.
Offer Duplicate object/selection in context menus and Ctrl/⌘+D on the canvas. Drag site/group
headers to move their contents; object moves change coordinates as well as membership. Snap to
the grid, show matching-edge guides and allow site/object swaps. Keep positions in project data
and the pan/zoom camera in the session. Avoid native orange mouse-focus outlines; retain a thin
theme-token keyboard focus indicator and the actual selection/connection highlights.

- Product name: **Sheco**. The logo is the rounded loop/Waltz mark in
  `src/components/Logo.tsx`, shared across the app. Keep it proportionate
  and aligned with the wordmark; do not restore a temporary logo chooser or invent more variants.
- Use neutral gray/white in light mode and neutral dark surfaces in dark mode. Settings offers
  neutral, blue, green, purple, and orange accents for controls and links; the default is neutral.
  Semantic tag and callout colors are allowed. Use `src/theme.css` tokens, including primary
  foreground/background tokens for readable buttons. Legacy names such as `--green` and `--sage`
  follow the selected accent and do not authorize recoloring the main surfaces.
- There is no Home dashboard. Pages open directly. Compact search beside the logo opens the
  search dialog; do not restore a large field that only acts as a dialog button.
- The sidebar collapse button beside search stays visible without hovering over the sidebar.
- The sidebar's right edge resizes by pointer or keyboard. Its width lives in workspace UI state
  (`sidebarWidth`, default 252px, 220–560px), with room retained for content in narrow windows.
  Save once after a pointer gesture; double-click returns to the default width.
- Settings uses a sidebar with General, Workspace, Data & backups, Plugins, and About
  Sheco categories. Keep navigation visible while the active panel scrolls, retain draft fields
  across category changes, and skip hidden panels in modal focus handling.
- Databases are inserted on normal pages through `/database`. Do not restore the sidebar's
  separate “New database” action. Entry names remain editable independently of opening the page.
- Omit the “space for your ideas” label and persistent `/`, `[[`, or backlinks hint sections.
  Slash commands and wiki links still work as editing features.
- Omit the top-bar “Local” indicator and sidebar “Stored on this device” block. Keep the
  sidebar footer focused on Plugins, Trash and Settings. Plugins opens an anchored menu of enabled
  plugins with a Manage plugins action. Command builder opens a persistent tab, never a document page.
  Plugin settings groups available cards under Documents, Tools and Integrations, with an
  All plugins filter. Category changes retain mounted cards and drafts. When Document templates
  is enabled, Templates appears immediately above Plugins in the sidebar and opens its library.
  Save as template in page-header and sidebar context menus shares one capture path and opens
  the copied page in its editor. Only Date and Time toolbar
  buttons author automatic fields at the retained caret; omit title/custom field pickers, manual
  field forms and property defaults. The focused editor has no internal catalog/search or
  description. Date/time use neutral inline atoms resembling Jira mentions; their anchored
  picker selects a per-occurrence explicit format without a duplicate locale option. Older
  locale values remain readable and show the matching concrete selection. Keep clipboard/persistence as literal tokens. Library cards create
  pages through a compact template/title dialog. Preserve old libraries and metadata without
  applying old custom tokens or property defaults. Data tools open a reusable app tab and a separate settings
  tab; `/data` appears when enabled. The sidebar omits the separate New page row and trailing
  arrow. The Pages header plus creates a blank root page; its menu offers New page,
  Page from template when enabled, and Import Markdown. Page context menus
  group creation, page actions, link/export and Trash, with separators; creation/import targets
  the chosen page and database targets produce entries. Blank space below the page list opens the
  same root actions by context click, anchored to the pointer. The same blank area remains
  a root drop destination with feedback while dragging pages. Use anchored, viewport-contained popovers
  with arrow/Home/End navigation and Escape focus return.
  Data tools place the recipe in a wrapping horizontal band above equal-width input/result panels.
  Add action and Run recipe are grouped on its header. Numbered cards expose a visible drag grip,
  pause/resume and remove buttons; no step actions are hidden in a three-dot menu. Native dragging
  from the grip shows a before/after insertion line and commits the immutable recipe on drop;
  cancellation leaves order/output intact. The focused grip also accepts arrow/Home/End keys.
  Paused cards retain position with a dashed outline and a Paused label. Clicking a name replaces
  its action through the searchable anchored category picker, with a bounded scrolling action list.
  Parameterized actions show compact labeled fields for literal search/replacement, delimiters and
  affixes, a Match case checkbox or Unicode-form picker. Multiline fields start at one row. Paused
  steps disable editing and retain values; dragging preserves them, while replacing an action clears
  its options. Input edits and recipe/default
  changes recompute after a short debounce; Run recipe and Ctrl/⌘+Enter run immediately.
  Panel headers group File/Clear and reuse/copy controls with translated accessible names/tooltips.
  Omit local processing/storage notes and persistent operation explanations; picker tooltips provide
  help. Files show name/size, retain raw bytes for hash/Base64/hex and preview UTF-8 read-only;
  removing one restores the prior draft. Errors mark the failing step and clear partial output.
  Relevant indentation/delimiter defaults stay on the card. Below 650px of content width the
  fields stack; the recipe remains above them, wrapping cards instead of reducing field width.
  Empty output remains copyable; stale computations/file reads cannot replace newer input.
  Keep input, file bytes, recipe and output out of document state.
  About Sheco shows the actual installed version and a manual Check for updates action, a
  Check for updates at startup switch (off by default), and a compact shared status panel.
  A found release also appears in a compact single row after the sidebar footer divider, above
  Templates; its version sits beside a small icon-only Open release button with a translated
  accessible name and tooltip. Long version labels truncate with a full-text tooltip. Both
  buttons open the specific GitHub release. An up-to-date result uses semantic green text, a check icon and a
  soft green surface without repeating the version. Show Open release only for an available
  update; omit explanatory text and a generic View releases action. Installation is manual.
  The About footer groups the project GitHub link below the Sheco name; it opens the repository
  through the existing explicit external-link action and stays available without an update.
  Keep its privacy note limited to no account, telemetry or automatic uploads; omit explanations
  about editor network blocking and browser link opening. Use compact padding and a small
  vertically centered icon; let the note grow naturally when text wraps.
  All seven plugin configuration screens and catalog cards use `PluginSettingsHeader`: a 22px
  icon in a 42px neutral tile, a 14px/600 title and a 12px/400 muted description. Use file preview
  settings as the visual reference. Page headings are 25px/600; setting labels are 12px/550 with
  theme text colors. Configuration-card headers add 12px of bottom padding to separate the
  icon/title/description/enable switch from the first setting; row spacing remains compact at
  6px vertically without dividers. Architecture settings includes the plugin enable switch,
  retaining diagrams and defaults when disabled. MCP's short header description fits one line
  at the supported settings widths while retaining the requirement that Sheco stay open. Command
  catalog and template editors retain their specialized controls beneath the same header.
  The file preview footer has a 6px top gap without a bottom paragraph margin. MCP readiness
  uses semantic green in both themes.
  Plugin settings contains the enabled switch and actions, without a second Enabled/Disabled
  label. Only plugins with slash commands show the shared command disclosure, collapsed by default;
  the disclosure is always titled Commands, including on disabled cards. `/commands` opens the command
  builder in a tab. Jira settings offer a server picker and Add server, with optional names and
  separate connection forms whose drafts survive switching. Removing a server retains issue snapshots.
  Insertion offers a server picker when needed; refresh uses the saved issue's server. A saved token has a fixed star
  mask and lock indicator, and the display view is selected on each issue. `/jira-inline` inserts a key/status reference
  at the caret in paragraphs and lists; detailed cards use a compact two-row layout,
  and status badges use semantic category colors in both themes. Configure opens a separate persistent
  Tool configuration tab, available even while the plugin is disabled. Command and configuration
  values use PopoverPicker; drafts remain in memory across app tab changes. The configuration tab
  shows a tool catalog, a parameter outline and one focused editor. Keep import/export/JSON actions
  in the catalog menu, deletion/reordering in contextual menus, and rare fields in Additional settings.
  On narrow views the tool catalog becomes a horizontal list while parameter navigation remains visible.
  The builder opens in Simple mode with nmap when present. Its centered tool name and down chevron
  open a custom tool picker. Required fields and added parameters form a centered vertical chain
  below that tool, with subtle connecting lines. Keep the searchable tool rail in Advanced mode only.
  Required fields are pre-added;
  Add parameter opens an anchored list of available options and inserts a block with its value
  editor inside. Simple cards use compact rows with the name on the left and value/choice on the right;
  narrow field areas stack the editor below its name. Boolean options share a dashed-outline group
  of wrapping horizontal chips with checks and removal buttons. Removing an optional parameter
  preserves its value for re-addition. Advanced mode exposes the full grouped catalog, flags and
  descriptions with equal-height required cards. Both modes share session values. Do not restore parameter quick filters, parameter
  search or explanatory/error text below the command. Show validation beside the relevant field and
  keep copy disabled while invalid. The command, shell picker and copy action remain in a fixed bottom
  dock while fields scroll independently. Reset and documentation belong in the tool's contextual menu;
  configuring tools still opens the separate configuration tab.
  In Simple mode omit the required-field star. Information icons open compact anchored help popovers sized to their text, capped at 240px. Simple repeatable fields use a centered 18px text line in their initial 34px editor.
  Suggested text values use a small dropdown beside the free input; paths and NSE expressions stay
  editable. Extended output in the command dock chooses shell-compatible pipe templates and defaults
  to Standard output. Selecting nmap NSE/default/aggressive scanning puts the NSE result templates first without changing the selected output. Configure in the builder header opens/reuses the catalog tab and retains command values until the catalog is applied. The configuration outline has a separate Output templates section.
- Keep workspace initial avatars square, selected rows/cells visually soft, and selection checks
  separate from labels. Drag destinations must be visible.

## Layout and interaction

Align tabs, back/forward/new-tab controls, sidebar controls, and platform window buttons on a
consistent vertical axis. Give macOS traffic lights adequate space. Verify other platform layout
when changing window chrome; a macOS screenshot is not Windows evidence.

Windows hides the application menu bar after each menu rebuild; menu accelerators remain
registered. Do not infer native Windows menu/shortcut behavior from a macOS check.

Keep page icon, title, description, and content aligned regardless of nesting depth or content
height. The stable scrollbar gutter prevents a few pixels of horizontal shift between pages.
Check empty, short, long, and nested pages before changing central layout rules.

Reuse `Popover` with an anchor in `src/components/ui.tsx` for small anchored menus. It portals to the
document body, uses viewport coordinates, measures available room, and tracks scrolling/anchor
visibility. Avoid menus inside clipping database/editor containers, hardcoded global coordinates,
or absolute positioning against an unrelated ancestor. Test near each viewport edge and while
scrolling, particularly inside an inline database.

Outside dismissal listens in the capture phase so editor controls cannot swallow it. Nested
portals belong to the same popover family; selecting a child item keeps its parent open. Escape
closes the top menu and returns focus to its trigger. Modal-owned portals retain their modal
accessibility ownership and participate in its keyboard focus trap, including nested popovers. Database property creation/editing and type
selection use compact anchored popovers, while record-name editing highlights the entire table
cell. Filter properties/operators and sort properties/directions use custom popovers with keyboard
selection. Opening a property editor from the properties list keeps that list underneath; saving,
cancelling or Escape returns to it. Type selection opens above the editor, and an outside click
closes the whole popover family.

`PopoverPicker` in `src/components/PopoverPicker.tsx` provides the shared custom choices used by
database fields and diagram shape/type/layout controls. Reuse it for finite lists rather than native
selects. Labels arrive translated. Its anchored listbox retains selected checks, keyboard navigation,
focus return and the enclosing popover family; diagram choices appear above their properties popup.

Database column headers open a quick filter for that column, including Name. Property editing
stays in the toolbar's properties menu. Filter value fields accept typing and offer selectable
values for select, multi-select, status, relation and checkbox properties. Include values already
used by records even when absent from the column's option list. Keep filter popovers compact,
with selectors above the value field, and retain filters on other columns when clearing one.

Database table widths update throughout pointer resizing, including wrapped cell text. Persist
the final width once after release; Escape, cancellation and leaving the view discard the gesture.
Name has its own saved width (`titleWidth`, default 220px) and shares pointer/keyboard resizing
with property columns, with a displayed minimum of 180px. Select, multi-select and status columns
have an intrinsic minimum that fits their widest tag and cell padding, including status dots,
unused schema options and existing record values. Recalculate it when options, values or font
metrics change; multiple tags can wrap. Apply these floors to legacy widths on display without
rewriting snapshots just to open them. Stored width preferences retain their 80–1000px range;
unusually long imported tags can require a larger displayed minimum.
Text-property editors retain the existing cell height and grow to
fit wrapped text. Enter saves, Shift+Enter adds a line and Escape cancels the draft.
Property fields fill the entire table-cell height, so clicks below a short value still edit it
or open its choices. Clicking empty space within an active editor retains focus and its draft.
Size inline editors before focusing them with `preventScroll`; opening or refocusing a cell must
retain the page and table scroll positions, including partially visible multiline cells.
Checkbox cells toggle from their empty area without double-toggling the input. Created/modified
timestamps remain automatically managed and read-only across the full cell.
Name cells also edit from their full height, keeping the icon, title and open-page button on the
top line. Retain the draft when clicking empty space, and focus without scrolling. Opening the
page remains a separate button/modifier action; the row drag handle must not start renaming.

Sidebar pages can be dragged before or after siblings, or inside another page. Show an insertion
line at the destination's nesting depth for ordering and a row outline for nesting. An insertion
after an expanded page goes after its whole subtree. Preserve all descendants, reject hierarchy
cycles, and keep database records in their database.

Code language/settings pickers use custom compact popovers rather than native language selects
or a full settings modal. Block context menus open both from the drag handle and right-click.
Turn into opens a separate anchored submenu on hover, keeping block actions visible. Prefer the
right side and flip left at the viewport edge. A bounded pointer corridor protects diagonal
travel between menus; leaving the corridor dismisses the submenu after a short delay. Arrow
keys navigate its items, and Escape/Left returns focus to the parent action.
Callouts expose an emoji picker and gray/yellow/red/green backgrounds. Page icons provide a
searchable, broad emoji selection.

Use semantic buttons, accessible names, keyboard activation, and deliberate focus return.
Pointer gestures must not steal text selection, activate controls accidentally, or leave an
invisible selection. Tooltips explain actions briefly without adding persistent tutorial clutter.

## Localization

Use `useI18n()`/`t()` from `src/i18n.tsx` and add Russian counterparts in
`src/shared/i18n.ts`. English strings are the translation keys. Include labels, placeholders,
tooltips, empty states, validation messages, and accessible names affected by a feature.

Changing language updates the interface and retains the local preference across restart. It must
not rename user pages, translate property values, or reseed document content. Keep unknown user
text unchanged. Check Russian text lengths and both themes; do not rely on fixed widths that only
fit English.

Use existing layout/print rules in `src/styles.css`. New persisted presentation settings need
corresponding export/print behavior where meaningful; see the [editor guide](editor.md).

Reading preferences (outline visibility, fixed width, and five font-size steps) live in workspace
UI state and apply to every page. The page menu and General settings share the same controls.
Database pages honor fixed/full width with the same page-width limits as notes; wider tables
scroll inside the database rather than expanding the page. Older snapshots receive compatible
defaults. The outline is a sticky side view to the right of
the document within the page, highlights the current heading, opens folded sections, and is hidden
in print; PDF uses a white page and preserves the selected font-size step. Page export uses one
anchored format submenu opened from the Export item with a trailing arrow. Choosing Markdown or
PDF, or CSV on database pages, directly opens the native save dialog; do not add an export modal.
Print rules retain hidden app/settings tabs as hidden, so PDF includes only the selected page.
Escape returns to the page-actions menu. Explicit copy buttons use `sheco.copyText`; architecture canvas shortcuts use native clipboard events with bounded validated JSON.

Trash rows keep SVG and emoji icons in the same fixed-width slot, with the title and deletion
date taking the remaining space. Do not apply expanding flex rules to every `span`, because emoji
icons also render as spans.

Simple table headers and body cells default to left alignment. Alignment controls apply to the
whole selected column (including its header and intersecting merged cells); new rows inherit
alignment. The existing cell `align` attribute is validated and reflected in Markdown/PDF.
The column handle opens alignment and reorder/delete actions. Compact table settings expose
automatic widths and separate first-row/first-column headers; edge strips append rows/columns.
Only the row/column with the caret shows an axis handle. Enabled header axes have no drag handle.
Pointer movement from an outer cell to its append strip must keep that strip visible and clickable.
Inline-code text follows the selected accent, with a light transparent tint for its background.

MCP is a plugin card with Configure opening its own settings tab; its device-local configuration, key, workspace scope and write permission remain canonical. File preview is a disabled-by-default workspace plugin. Its tabs reference registered attachment IDs, never filesystem paths. PDF uses the local PDF.js core canvas renderer; raster images and videos use registered asset URLs. Keep external opening available. Jira insertion/replacement fields stay inside each block; inline wrappers retain ordinary text caret geometry. Detailed Jira dates align to the right padding independently of hover controls. The Pages header action menu exposes Markdown import.

All plugin configuration opens in reusable settings tabs, available while disabled. Jira and MCP form drafts stay mounted while another tab is active and disappear on close. PDF defaults to fitting height within the available viewport, has compact editable page navigation sized to the page count, icon-only outline/page tabs with accessible names, and a horizontal scale dock at the bottom right inside the viewport. Group only zoom out, percentage and zoom in in the dock; fit height and fit width belong in the percentage menu. Ctrl-wheel trackpad pinch scales the visible bitmap immediately; bounded raster rendering happens in an offscreen buffer and swaps only when complete. Ordinary vertical wheel input scrolls a zoomed page first. A gesture that reaches its top or bottom consumes its overshoot and remaining momentum without turning the page; navigation rearms after a short pause or reversal. Slow input holds the current page at its edge before a deliberate turn, suppressing the remainder of that slow gesture. Strong or sustained fast input carries its distance across multiple pages, including while rasterization is pending; a weak tail alone cannot trigger another turn. Returning to the previous page lands at its bottom. Page-input Enter returns focus to the document without a container outline. Unwrapped text scrolls inside its bordered preview card. PDF session UI is cached by workspace/tab identity, not persisted as document content. Text preview uses escaped plain text; images no longer have preview-tab controls.

Inline Jira references use one neutral background without an outer border; the status keeps its semantic text/icon color without a separate background or border. Compact line height and equal 2px external margins keep them balanced within text. The atomic inline wrapper reserves 2px above and below for separation on wrapped lines; the native caret after a reference stays clear of its background in paragraphs and lists. Image crop reset belongs inside the crop dialog; it restores the original through the existing undoable image/gallery transaction.
