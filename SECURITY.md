# Security policy

## Reporting a vulnerability

Email **[shecof@ya.ru](mailto:shecof@ya.ru)** privately with the affected version or commit,
operating system, reproduction steps using synthetic data, and the expected security impact.
Do not post exploit details, access keys, or personal workspaces in public issues or pull requests.
Use a minimal example instead of sending a complete workspace containing private documents.

The project is in active development; security maintenance currently targets the latest source
revision. There is no separate long-term support or backport branch. Ordinary bugs belong in
the public issue tracker. Email is the documented private reporting channel; a public repository
alone does not confirm that GitHub private vulnerability reporting has been enabled.

## Security model

Sheco is a local desktop application. Its documents are untrusted data, not executable content.

The Electron window uses sandboxing, context isolation, and disabled Node integration. The preload exposes a fixed set of operations rather than arbitrary IPC channels. Every invoked operation is restricted to the application's main frame. Workspace data is validated with a versioned schema, including page identity, parent references, cycles, database membership, and column identifiers. Generated attachment paths are resolved beneath the workspace and checked after resolving symlinks.

The production Content Security Policy permits local scripts and styles, local fonts, local raster attachment images, and registered local video media. PDF preview uses a bundled PDF.js core worker and canvas renderer; only bundled WebAssembly codecs may compile under CSP, while JavaScript eval remains denied. Local worker blob wrappers are allowed; remote resources and PDF scripting/embedded actions are not executed. KaTeX uses `trust: false`. Renderer network requests, window creation, navigation away from the app, embedded frames, and permission requests are denied. Web and email links are opened externally only for allowed schemes. SVG attachments are never rendered in the editor. Markdown imports never fetch external images and do not import files outside the selected document's directory.

Filesystem saves are serialized, atomic, revision checked, and compared against a fingerprint of the on-disk snapshot. A workspace lock prevents independent local writers. Backups are made before replacement and invalid snapshots are preserved during recovery. Closing waits for pending saves. A failed save leaves the editor open and retains the in-memory edits for a recovery export.

The optional MCP server is disabled by default and listens exclusively on IPv4 loopback. It validates Host and Origin headers before processing requests, requires a random 256-bit Bearer key using constant-time comparison, bounds request bodies/connections, and offers read-only or read/write access to one explicitly selected workspace. Access pauses when another workspace is open. Credentials use the app's atomic settings file (mode 0600 on POSIX); they are excluded from workspace exports. Rotating a key revokes old credentials. MCP protocol handling uses the official TypeScript SDK.

MCP writes go through the live renderer and its existing save queue, rather than a second filesystem writer. Pending user edits are flushed first; page edits require their latest monotonic updatedAt and schema changes require a workspace revision. Expired requests are checked before mutation. New content is validated with the actual editor schema, node/attribute limits, and local page/attachment references. Arbitrary executable blocks, remote/file image URLs and unsupported link protocols are rejected. File tools accept registered IDs or bytes, never paths. Trash remains recoverable, and database columns with populated values cannot be removed until cleared. Authentication and workspace scope are rechecked before each queued operation.

Trust boundaries and limits:

- Document templates are bounded workspace data, not executable templates. Substitution changes
  date/time text only using the creation clock; title/custom tokens and supplied override values
  are not substituted. Legacy field/default metadata remains readable without manual forms or
  property-default application. Creation and library Apply validate the real editor schema and same-workspace
  references. Captured Jira blocks never fetch automatically. Templates are included in exports
  and backups, like pages.
- Data transformations render input/result as plain text and reject XML DTD/entity declarations.
  Explicitly selected browser Files are size-checked before reading; there is no arbitrary path
  or new filesystem IPC capability. Input, files and every intermediate/final result are limited
  to 1 MiB, with at most 32 recipe steps. Hashes and Base64/hex encoding retain exact file bytes;
  text operations reject invalid UTF-8. Inputs, file bytes, recipes and results remain in the
  renderer session and never enter workspace snapshots, exports or backups. Copy is an explicit
  clipboard action.
  Per-step text parameters have a 1 KiB limit. Search patterns are escaped literal text, with no
  user regex or evaluated replacement expressions; joins, replacements and affixes enforce the
  output byte limit while assembling their result. CRC-32 also reads exact file bytes.
- Manual and opt-in startup update checks use a fixed GitHub latest-release URL in a separate ephemeral main-process
  session, with no credentials, redirects or workspace content. Requests time out after 10 seconds
  and responses are limited to 1 MiB. Tags and release flags are validated; external release URLs
  are reconstructed from the fixed repository. No automatic download, execution or installation
  capability is exposed to the renderer. Startup checks default off and run once per launch
  when enabled. The strict boolean preference is stored in device-local `updates.json`, read
  with a 4 KiB limit; damaged files remain untouched and cannot enable network checks. Preference
  writes are serialized atomic replacements, excluded from workspace exports and backups.

- Plugin definitions are bounded, versioned JSON data. The command builder quotes individual
  arguments and only copies the resulting command; it has no process execution capability.
  Imported definitions never evaluate JavaScript or load remote code. Command values, including
  passwords and tokens, stay in the renderer session and are excluded from workspace snapshots
  and plugin exports. Users review a configuration draft before applying an imported catalog.

- Filesystem contents, operating-system associations, and third-party sync tools remain under the user's control. Unsupported attachments and explicit external opening delegate to the associated application. The optional file preview plugin uses only registered IDs and contained real paths, never arbitrary renderer paths. Raster MIME must match the generated extension; SVG/HTML are not rendered. Video delivery requires the enabled plugin and supports bounded streaming ranges. PDF and plain-text reads require the active workspace and enabled plugin, are capped at 64 MiB / 4 MiB, and recheck scope after asynchronous reads. Plain text is decoded as UTF-8 or BOM-marked UTF-16 and rendered as escaped text, never HTML/JavaScript. Images remain editor media and are not opened in preview tabs. PDF outline navigation accepts only internal destinations; external outline actions do not execute.
- The optional Jira plugin reads only issues from its configured server through fixed,
  sender-checked main-process methods. It sends PATs as Bearer headers or Cloud email/API tokens as Basic headers only on explicit
  insert/refresh actions, never follows redirects, and bounds request time and response size.
  Jira tokens and Cloud email are encrypted with Electron `safeStorage` in a device-local settings file outside
  workspace snapshots, exports and backups. There is no plaintext fallback if encryption
  is unavailable, and no renderer/MCP method to retrieve a token. Status can return the saved Cloud email. Scoped Cloud tokens
  go only to the fixed `api.atlassian.com` gateway; Cloud ID discovery on the configured
  HTTPS `*.atlassian.net` site carries no credentials. Saved issue snapshots are
  ordinary unencrypted workspace content. Remote credential operations require HTTPS; HTTP is accepted only for exact loopback hosts.
  The saved-token star mask is a fixed placeholder, never a decrypted credential or its length.
  `safeStorage` uses macOS Keychain and Windows DPAPI. Windows protects against other
  users, not other applications running as the same user. This is local storage protection,
  not a guarantee against a compromised OS/account; no independent security audit is recorded.
  See the [Electron platform guarantees](https://www.electronjs.org/docs/latest/api/safe-storage).
- A folder synchronized by another device is not a transaction-aware database. Edit on one device at a time; fingerprints detect changes before a save, but cannot prevent a third-party writer racing the final replacement.
- MCP credentials grant the chosen access to the authorized workspace. Connected agents decide how they process that data; Sheco does not control their providers. Workspace content is untrusted data, not agent instructions.
- Data, MCP settings, and backups are not encrypted, and backups are not secure erasure.
- Public binaries require platform code signing and macOS notarization. Distribution signing credentials must never be committed.
- Electron and dependency updates must be reviewed, rebuilt, and tested. `package-lock.json` pins the reviewed dependency tree; run `npm audit` before releases.

Do not publish user workspaces, recovery files, or test artifacts that contain personal data.
