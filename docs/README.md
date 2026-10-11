# Sheco documentation

The root [README](../README.md) is the project entry point; [README.ru.md](../README.ru.md)
provides the same quick start in Russian. Detailed guides live here.

| Reader                 | Start here                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Users                  | [Using Sheco](user-guide.md): editor, databases, files, MCP, exports, storage, and limits                          |
| Plugin users           | [Plugins and portable JSON — Russian](plugins.md)                                                                  |
| Contributors           | [Contributing](../CONTRIBUTING.md), [development guides](development/README.md), [testing](development/testing.md) |
| Architecture reviewers | [Data and process ownership](development/architecture.md), [security policy](../SECURITY.md)                       |
| Maintainers            | [Release preparation](releasing.md), [CI results](https://github.com/shecof/Sheco/actions)                         |

## Maintaining documentation

- Keep `README.md` and `README.ru.md` aligned: description, status, quick start, limits, and license.
- Put detailed user behavior and formats in `user-guide.md` and `plugins.md`.
- Keep contribution instructions in `CONTRIBUTING.md` and implementation details in `development/`.
- Keep private vulnerability reporting and security boundaries in `SECURITY.md`.
- Describe release checks and signing in `releasing.md`; report actual verification in CI,
  pull requests, and release notes.

Check links, commands, and source claims when revising a guide. Use relative paths and synthetic
examples; do not include credentials, personal workspaces, or workstation-specific paths.
