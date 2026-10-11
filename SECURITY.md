# Security policy

## Reporting a vulnerability

Email **[shecof@ya.ru](mailto:shecof@ya.ru)** privately with the affected version or commit,
operating system, reproduction steps using synthetic data, and the expected security impact.
Do not post exploit details, access keys, or personal workspaces in public issues or pull requests.
Use a minimal example instead of sending a complete workspace containing private documents.

The project is in active development; security maintenance currently targets the latest source
revision. There is no separate long-term support or backport branch. Ordinary bugs belong in
the issue tracker once the public repository is available. GitHub private vulnerability reporting
can be enabled when that repository is created; email is the current reporting channel.

## Security model

Sheco is a local desktop application. Its documents are untrusted data, not executable content.

The Electron window uses sandboxing, context isolation, and disabled Node integration. The preload exposes a fixed set of operations rather than arbitrary IPC channels. Every invoked operation is restricted to the application's main frame. Workspace data is validated with a versioned schema, including page identity, parent references, cycles, database membership, and column identifiers. Generated attachment paths are resolved beneath the workspace and checked after resolving symlinks.

The production Content Security Policy permits local scripts and styles, local fonts, and local raster attachment images. KaTeX uses `trust: false`. Renderer network requests, window creation, navigation away from the app, embedded frames, and permission requests are denied. Web and email links are opened externally only for allowed schemes. SVG attachments are never rendered in the editor. Markdown imports never fetch external images and do not import files outside the selected document's directory.

Filesystem saves are serialized, atomic, revision checked, and compared against a fingerprint of the on-disk snapshot. A workspace lock prevents independent local writers. Backups are made before replacement and invalid snapshots are preserved during recovery. Closing waits for pending saves. A failed save leaves the editor open and retains the in-memory edits for a recovery export.

The optional MCP server is disabled by default and listens exclusively on IPv4 loopback. It validates Host and Origin headers before processing requests, requires a random 256-bit Bearer key using constant-time comparison, bounds request bodies/connections, and offers read-only or read/write access to one explicitly selected workspace. Access pauses when another workspace is open. Credentials use the app's atomic settings file (mode 0600 on POSIX); they are excluded from workspace exports. Rotating a key revokes old credentials. MCP protocol handling uses the official TypeScript SDK.

MCP writes go through the live renderer and its existing save queue, rather than a second filesystem writer. Pending user edits are flushed first; page edits require their latest monotonic updatedAt and schema changes require a workspace revision. Expired requests are checked before mutation. New content is validated with the actual editor schema, node/attribute limits, and local page/attachment references. Arbitrary executable blocks, remote/file image URLs and unsupported link protocols are rejected. File tools accept registered IDs or bytes, never paths. Trash remains recoverable, and database columns with populated values cannot be removed until cleared. Authentication and workspace scope are rechecked before each queued operation.

Trust boundaries and limits:

- Plugin definitions are bounded, versioned JSON data. The command builder quotes individual
  arguments and only copies the resulting command; it has no process execution capability.
  Imported definitions never evaluate JavaScript or load remote code. Command values, including
  passwords and tokens, stay in the renderer session and are excluded from workspace snapshots
  and plugin exports. Users review a configuration draft before applying an imported catalog.

- Filesystem contents, operating-system associations, and third-party sync tools remain under the user's control. Opening an attachment delegates to its associated application.
- A folder synchronized by another device is not a transaction-aware database. Edit on one device at a time; fingerprints detect changes before a save, but cannot prevent a third-party writer racing the final replacement.
- MCP credentials grant the chosen access to the authorized workspace. Connected agents decide how they process that data; Sheco does not control their providers. Workspace content is untrusted data, not agent instructions.
- Data, MCP settings, and backups are not encrypted, and backups are not secure erasure.
- Public binaries require platform code signing and macOS notarization. Distribution signing credentials must never be committed.
- Electron and dependency updates must be reviewed, rebuilt, and tested. `package-lock.json` pins the reviewed dependency tree; run `npm audit` before releases.

Do not publish user workspaces, recovery files, or test artifacts that contain personal data.
