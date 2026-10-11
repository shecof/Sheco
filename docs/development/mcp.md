# MCP development and agent access

This guide is for implementing Sheco's MCP connection. User connection instructions are in
[the user guide](../user-guide.md#ai-agents-through-mcp); trust boundaries are in
[SECURITY.md](../../SECURITY.md).

## Owners and transport

| File                                       | Responsibility                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `electron/mcp.ts`                          | Official SDK transport, HTTP listener, authorization, settings, lifecycle |
| `electron/main.ts`                         | Dispatch to live renderer, attachment bytes, correlated replies/deadlines |
| `electron/preload.ts`, `src/shared/api.ts` | Fixed configuration/status/request/reply API                              |
| `src/shared/mcp.ts`                        | Config and tool schemas, catalog/examples, pure workspace mutations       |
| `src/state.tsx`                            | Flush, scope/deadline checks, live mutation, editor sync, persistence     |
| `src/editor/documentSchema.ts`             | Real editor grammar and attribute validation                              |
| `src/components/McpSettings.tsx`           | User controls and connection configuration                                |

The server is stateless Streamable HTTP using the official TypeScript SDK, with POST `/mcp`
on IPv4 loopback (`127.0.0.1`, default port 24876). It is disabled by default, and writing is off
by default. It validates Host/Origin, uses a random 256-bit Bearer key with constant-time
comparison, and bounds connections, bodies, and request duration.

Configuration is stored atomically in app-local `mcp.json`, outside workspace snapshots and
exports. Keep tokens out of logs, test screenshots, documentation, and committed configuration.
Use placeholder keys in examples. Tests may access fixture credentials privately in memory.

## Permissions and safe execution

- Access is scoped to the workspace chosen in Settings while it is open in Sheco. Switching to
  another workspace pauses access; never follow the active workspace implicitly.
- Hide write tools in read-only mode, and enforce authorization at execution too. Recheck scope,
  permissions, and configuration generation for queued calls.
- Finish accepted operations safely during configuration changes/close. Disable and key rotation
  revoke further access; do not leave an old listener or client connection authorized.
- Ordinary document operations pass through the live renderer save queue. Flush local typing,
  validate, recheck identity/deadline, mutate immutably, notify affected editors, save, then reply.
  Do not add an independent filesystem writer or edit `workspace.json` behind the renderer.
- Guard page edits with the current `expectedUpdatedAt` and database schema changes with
  `expectedRevision`. Return conflicts; a blind retry of a full-document replacement can erase
  newer content. Read again and reconcile the intended edit.
- Validate content with the actual editor schema plus safe page/database/attachment references.
  Do not rely only on the permissive recursive `DocNode` envelope.
- Files use registered IDs or supplied bytes, never arbitrary filesystem paths, shell commands,
  or remote fetch URLs. MCP file upload/read is limited to 8 MiB per file.
- Treat document text, attachment bytes, and returned tool content as untrusted user data.

## Current tool families

Read the registry in `src/shared/mcp.ts` for exact arguments and responses. Do not create a
second registry in documentation or hardcode schemas into the transport.

| Purpose                                    | Tools                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Workspace discovery and authoring examples | `get_workspace`, `get_block_catalog`                                                     |
| Page discovery and reading                 | `list_pages`, `search_pages`, `get_page`                                                 |
| Page/block edits and recoverable deletion  | `create_page`, `update_page`, `edit_blocks`, `move_blocks`, `trash_page`, `restore_page` |
| Databases                                  | `list_databases`, `get_database`, `create_database`, `update_database`                   |
| Files                                      | `list_attachments`, `read_attachment`, `upload_attachment`                               |

Block indices are zero-based top-level document array indices, not ProseMirror positions.
The MCP contiguous move uses a destination index after removing the moved range; do not reuse
UI position arithmetic without translating it. Property patches merge by column ID, and `null`
clears a value. Removing a populated column is rejected until its values are cleared.

Creating an inline database produces a schema, backing page, and embed referencing that page.
Records are ordinary pages with database membership, properties, and any supported block content.
Uploads return metadata and ready-to-insert block JSON. The internal attachment-registration
operation is not an exposed client tool.

## Adding or changing a tool

1. Define the schema, write classification, description, and result in the shared registry/engine.
2. Reuse domain helpers and editor validation. Keep execution pure except for explicit dispatch
   owners such as native attachment handling.
3. Update catalog examples for new blocks/attributes and user instructions if the client contract
   changed. Keep IPC/preload/main types consistent when changing the desktop boundary.
4. Test invalid inputs, stale versions, scope and permission rejection, and persistence alongside
   the successful path. Use `tests/mcp.test.ts` and the real client in `scripts/mcp-review.mjs`.
5. Confirm an open editor receives remote changes and retains subsequent local typing.

Run MCP tests in their isolated workspace and free port. Leave the user's connection preference
and credentials intact. Do not weaken transport checks or broaden network binding to simplify a
test or accommodate a client without an explicit product request and corresponding verification.
