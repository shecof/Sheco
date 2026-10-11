# Product and UI conventions

These conventions describe the current interface. Discuss changes to product direction before
reworking them; avoid restoring superseded designs from old screenshots or unused strings.

## Appearance and navigation

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
- Settings uses a sidebar with General, Workspace, Data & backups, AI agents · MCP, Plugins, and About
  Sheco categories. Keep navigation visible while the active panel scrolls, retain draft fields
  across category changes, and skip hidden panels in modal focus handling.
- Databases are inserted on normal pages through `/database`. Do not restore the sidebar's
  separate “New database” action. Entry names remain editable independently of opening the page.
- Omit the “space for your ideas” label and persistent `/`, `[[`, or backlinks hint sections.
  Slash commands and wiki links still work as editing features.
- Omit the top-bar “Local” indicator and sidebar “Stored on this device” block. Keep the
  sidebar footer focused on Plugins, Trash and Settings. Plugins opens an anchored menu of enabled
  plugins with a Manage plugins action. Command builder opens a persistent tab, never a document page.
  Plugin settings contains the enabled switch and actions. Configure opens a separate persistent
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
  In Simple mode omit the required-field star. Information icons open real anchored help popovers.
  Suggested text values use a small dropdown beside the free input; paths and NSE expressions stay
  editable. Extended output in the command dock chooses shell-compatible pipe templates and defaults
  to Standard output. The configuration outline has a separate Output templates section.
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
Escape returns to the page-actions menu. Clipboard actions use `sheco.copyText`.

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
