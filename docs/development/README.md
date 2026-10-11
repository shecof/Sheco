# Development guides

Start with [Contributing](../../CONTRIBUTING.md) for setup and the contribution workflow.
These guides describe the implementation and the checks relevant to each area.

| Guide                           | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| [Architecture](architecture.md) | Process boundaries, state, storage, pages, and databases   |
| [Development](development.md)   | Setup, isolated data, debugging, preview, and packaging    |
| [Testing](testing.md)           | Existing suites, fixtures, and verification                |
| [Editor](editor.md)             | Schema, transactions, selection, media, and exports        |
| [UI](ui.md)                     | Appearance, navigation, localization, and controls         |
| [MCP](mcp.md)                   | Local client integration, permissions, and safe operations |

See [plugins](../plugins.md) for portable configuration, [the user guide](../user-guide.md)
for app behavior, [SECURITY.md](../../SECURITY.md) for trust boundaries, and
[release preparation](../releasing.md) for distribution.

Check guides against source and `package.json` when behavior or commands change. Keep paths
relative, examples synthetic, and documentation separate from unimplemented proposals.
