# Using Sheco

See [README.md](../README.md) for a quick start and [development](development/development.md)
for isolated source runs. The first normal launch creates the illustrative **Knowledge** workspace
in `Documents/Sheco/Knowledge`; an isolated launch creates it beneath `SHECO_DATA_DIR/Knowledge`.
Use the workspace menu to create an empty space or open an existing one.

## What is included

- Compact search next to the logo opens the workspace search dialog; ⌘K / Ctrl+K also works. Navigation opens pages directly, without a Home dashboard.
- Search matches full registered filenames for attachments, pictures and slider images. File results show the filename and owning page; choosing one opens that page. Trash and unreferenced attachments are excluded.
- Insert a local Mermaid diagram with `/mermaid`. The compact pencil button opens code with a live preview and a visual editor for simple flowcharts: a canvas with a floating tool palette for five block shapes, directed arrows and ordinary connections. Place blocks with a click, connect them by dragging or selecting both ends, and edit labels/shapes/link types in anchored popups. Connections follow straight axes or right-angle bends; nearly aligned blocks share a straight connection without changing their positions. The canvas supports zoom, pan, fit, four layout directions, automatic layout and pointer/arrow-key movement. Other Mermaid types and richer flowcharts use the code editor without rewriting their source. Apply saves one undoable edit; Cancel leaves the document unchanged. On the page, diagrams default to 65% scale; the −/+ buttons change each diagram from 25% to 200%, and clicking the percentage resets it. Page scale is saved separately from canvas zoom and retained during editing and PDF export. Mermaid Markdown fences import as diagrams; Markdown exports the code. Workspace JSON and HTML clipboard data retain manual positions and scale; Markdown does not retain them.
- Find in the current page with ⌘F / Ctrl+F. Expand replacement, use Ctrl+H / ⌘Shift+H, or choose **Find and replace** in Page options. Search supports case sensitivity, previous/next matches and replacing one/all matches with undo.
- Resize the sidebar from its right edge; the width is remembered in the workspace. Arrow keys resize the focused edge, and double-click restores the default width.
- Independent workspaces, stored in ordinary local folders. No account or hosted service.
- Hierarchical pages, drag and drop nesting/reordering, breadcrumbs, context actions, favorites, and reversible deletion.
- Restored and draggable tabs; Cmd/Ctrl+T, W, K, N and 1–9.
- A Tiptap/ProseMirror editor with undo/redo, marquee block selection with batch dragging and deletion, duplication/movement, searchable slash commands, headings 1–4, rich text, nested lists/tasks, collapsible sections, quotes, callouts, code languages/highlighting/copy with titles, line numbers, compact settings, and default folding, images with captions, sliders, aspect-preserving resize handles and reversible crops, multiple file attachments, math, and resizable simple tables.
- `[[` autocomplete, completed `[[Title]]` input rules, page link blocks, and internal reference tracking. Deleted link targets stay visible rather than silently disappearing.
- Database entries that are complete pages. Text, number, checkbox, select, multi-select, date, URL, email, status, relation/page, and automatic creation/modification properties.
- Inline databases inserted with `/database`, backed by independent schemas and full page records.
- Table, list, board, and gallery views. Editable names and cells, filters, sorting, search, resizable/draggable/hideable columns, and before/after drop markers. Board grouping uses the first status/select property.
- Markdown page import/export, CSV database export, PDF of the current page, and full portable workspace export with the hierarchy and attachments.
- Settings has sidebar categories for General, Workspace, Data & backups, AI agents · MCP, Plugins, and About Sheco. Switching categories retains draft fields; arrow keys, Home, and End navigate the sidebar. English and Russian can be switched immediately, with the preference kept locally across restarts; document titles and user property values are preserved.
- Workspace plugins can be enabled or disabled in Settings and opened from the sidebar footer. The first plugin builds commands in a separate tab for nmap, ffuf, gobuster, hashcat, John the Ripper, curl, hydra, searchsploit and socat. Tool definitions and parameters are editable in their own tab, visually or as portable JSON; Bash/Zsh and PowerShell quoting are supported. Commands are copied, never executed. See the [plugin guide and JSON format](plugins.md).
- Drop files anywhere on a note page or use `/image` or `/attachment`. Multiple images can be separate blocks or a slider; sliders can be split later without losing per-image settings. Captions are searchable and included in Markdown/PDF. Every slide appears in exports.
- Hover or focus an attachment and open **File view** to choose a wide card, compact rectangle, square tile, or link with a file icon. Consecutive compact rectangles and square tiles share a row while space allows and wrap automatically. Each block remembers its own view; opening the file works in every view.
- Drag across the page gutters to select blocks; Shift adds to the selection. Text blocks use a light accent background and other blocks use accent outlines. Copy/cut retains the whole selected group. Drag any selected block handle, picture, or file card to move the group. Backspace/Delete removes the selection, Escape clears it, Ctrl+D / ⌘D duplicates the group or current block, and undo restores changes. Right-click a block for its actions.
- Code settings open beside the header button. Code can be folded, with a persisted collapsed-by-default preference; print/PDF includes the complete code. Slider images share one display width.
- Image handles resize the displayed picture without changing its source. Crop uses a free frame, keeps the original, and stores a PNG copy locally for portable exports. Animated sources crop to a still image; Reset crop restores the original.
- Neutral light and dark themes, plus system appearance. Searchable emoji icons, four callout backgrounds, and a custom code language picker.
- Atomic, revision-checked saves, backup checkpoints, crash recovery, a workspace writer lock, external edit conflict detection, and an unsaved recovery export.

## AI agents through MCP

Open **Settings → AI agents · MCP**, enable the connection and select the accessible workspace. Enable **Allow changes** for writing; the default is read-only. Keep Sheco open in that workspace. Switching spaces pauses access until the authorized workspace is opened again or the user selects the new one in Settings.

The app runs a [Streamable HTTP MCP server](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) at `http://127.0.0.1:24876/mcp` by default. The port can be changed. **Copy connection settings** provides this configuration with your actual key:

```json
{
  "mcpServers": {
    "sheco": {
      "url": "http://127.0.0.1:24876/mcp",
      "headers": { "Authorization": "Bearer YOUR_ACCESS_KEY" }
    }
  }
}
```

Use a client that supports Streamable HTTP and custom authorization headers. Some clients call this an HTTP server or use a different configuration wrapper; paste the same address and Bearer key into their connection fields. The listener binds only to this computer. Generating a new key revokes the old key. MCP settings and credentials stay in the app's local data directory, outside workspace exports and backups.

There are 18 tools: `get_workspace`, `get_block_catalog`, `list_pages`, `search_pages`, `get_page`, `create_page`, `update_page`, `edit_blocks`, `move_blocks`, `trash_page`, `restore_page`, `list_databases`, `get_database`, `create_database`, `update_database`, `list_attachments`, `read_attachment`, and `upload_attachment`. Write tools are absent when changes are disabled. The catalog includes examples for every editor block, nested content, rich text, galleries and inline databases. Database entries are ordinary pages with editable properties and full block content; property patches merge by column ID.

Start with `get_workspace` and `get_block_catalog`. Read `get_page` before editing and pass its `updatedAt` as `expectedUpdatedAt`. Block indices refer to the zero-based top-level document array. Database schema updates require the latest workspace revision. Conflicts return an error rather than replacing newer edits. Uploads return ready-to-insert image or attachment JSON; uploads and reads are limited to 8 MiB per file through MCP. The normal UI retains its 200 MiB attachment limit. Page deletion moves content to recoverable Trash.

Agent edits are validated against the **same schema as the editor**, flush pending local changes before running, update open documents, and save through the existing serialized, revision-checked store with backup checkpoints. Agents cannot run arbitrary code or request arbitrary filesystem paths through these tools.

## Storage and backups

```text
Knowledge/
  workspace.json          # Versioned, normalized documents, database schemas, UI state
  attachments/            # Copied local files, addressed with generated identifiers
  metadata/
    writer.lock           # One writer per workspace
    backups/              # Last 30 durable checkpoints
    manual-backups/       # Complete snapshots, including attachments
    damaged-*.json        # Preserved invalid snapshot when a backup is recovered
```

`workspace.json` is the source of truth. Attachments remain separate so they do not inflate document snapshots. Saves write and sync a temporary file, preserve the previous checkpoint, and atomically replace the current snapshot. The snapshot format is explicitly versioned and validated before loading or saving. The original data is preserved if recovery fails.

Copy the **entire folder** after closing its writer to move a space. Use **Settings → Export workspace** for a portable snapshot plus readable Markdown/CSV copies. **Open workspace folder** can open the exported snapshot or a manual backup. The `metadata` directory is not needed for a portable export. Recovery JSON files contain documents and attachment references; keep the original attachments folder alongside them when recovering.

Folders in iCloud Drive, Dropbox, Syncthing, or Git may be used, but only one device should edit a workspace at a time. Sheco does not implement collaborative merging or coordinate third-party synchronization. If the file changes externally, saving stops and the in-memory edits remain available for recovery export. Do not overwrite the conflicting original to resolve a warning without making a copy first.

## Privacy and security

The renderer is sandboxed, has no Node.js access, and communicates through a fixed preload API. Main-process handlers check the sender and validate record inputs. Navigation, new windows, permissions, remote images, and network requests are blocked. Only local app resources and registered local raster attachments can be loaded. Clicking a web/email link opens the system browser. Local attachments open in their associated application when requested. See [SECURITY.md](../SECURITY.md).

Documents are **not encrypted**. Use operating-system disk encryption and normal filesystem access controls if you need confidentiality at rest. Automatic backups deliberately retain prior versions, including deleted content. Sheco is not a secure-erasure tool.

## Current limits

The current implementation uses complete JSON checkpoints with a 64 MiB document snapshot limit and a 200 MiB limit per attachment. It is intended for personal collections; database/table rendering is not virtualized. Exceptionally large collections may benefit from a future SQLite/FTS storage adapter and virtualized tables. Search is local in memory. Language auto-detection for code is not included; explicit language selection and highlighting are available.

Markdown is a portable representation, not a lossless editor round trip: custom callouts, toggles, internal links, properties, and attachments have readable representations; **workspace.json** preserves the exact Sheco data. Markdown includes the cropped image file; display widths are layout settings preserved by the workspace snapshot and PDF, rather than standard Markdown syntax. Missing, outside-folder, or remote images are not downloaded during import. Board grouping currently supports one property. PDF exports use the rendered active view and print styling; wide tables may fit differently from the window.
