# Contributing to Sheco

Bug reports, documentation improvements, translations, and focused code changes are welcome.
Please follow the [code of conduct](CODE_OF_CONDUCT.md). Report security issues privately using
[SECURITY.md](SECURITY.md), rather than a public issue or pull request.

## Before you start

Read [README.md](README.md) and the relevant [development guides](docs/development/README.md).
Start with architecture for storage or process changes and testing for verification choices.

For a public repository, fork it and make a branch for your change. In a local checkout, create
a branch from the current baseline. Keep each pull request focused on one problem; discuss
changes to storage, security boundaries, or product direction before building a large feature.

## Set up and run

Use Node.js 22.12+ and npm on macOS or Windows, then run `npm ci` from the repository root.
Follow the [isolated quick start](README.md#try-it-from-source) or the
[development guide](docs/development/development.md). `SHECO_DATA_DIR` selects a separate app profile;
opening an existing workspace through the app still opens that selected folder.

Automated mutations must use fresh fixtures. `test-results/design-preview/` is persistent user
data: do not reset it, remove locks, or restore its Trash to make a test pass. Never include
personal workspaces, attachments, credentials, recovery files, or private screenshots in a report.
Use a minimal synthetic example instead.

## Make a change

- Follow the existing strict TypeScript, React hooks, and Prettier conventions.
- Use the current state/save pipeline and ProseMirror transactions. Preserve existing snapshots
  and validate migrations before writing a changed format.
- Use theme tokens and translated strings. Check English/Russian and light/dark when affected.
- Keep dependencies and lockfile changes intentional. Do not modify generated bundles.
- Update user documentation and relevant development guides when behavior, commands, or ownership changes.
  Keep [README.ru.md](README.ru.md) aligned with the English entry point.

## Verify

For code changes:

```sh
npm run check
```

Choose relevant desktop suites from the [testing matrix](docs/development/testing.md). They use compiled
output, so run `npm run build` after source edits before running a desktop suite. `check` already
builds the app. Storage, conflict handling, imports, and permission changes need failure-path
coverage; add a regression test when it proves the behavior being fixed.

For documentation changes, check local links and documented commands, then run targeted formatting:

```sh
npx --no-install prettier --check README.md README.ru.md CONTRIBUTING.md
```

Include every changed Markdown/configuration file in that check. There is no dedicated link-check
script at present; resolve relative file links from the document's directory and verify anchors.
Do not run broad `npm run format` just to format a focused edit.

For meaningful behavior changes, report the checks actually run in the pull request or release
notes. State the operating system and distinguish source-app tests from installer or packaged-app
tests. Documentation-only changes need link and formatting checks.

## Submit

Explain the problem, the resulting behavior, and the checks performed. Include safe screenshots
when they help review an interface change. Note checks that could not run and remaining limits.
Inspect your diff and the files being committed; ignore rules cannot detect all secrets or private
data. Do not commit generated output or package installers.

Use the issue and pull request templates in the repository. Reproductions
should include OS, app version or commit, exact steps, expected/observed behavior, and whether the
problem occurs in a fresh fixture. Contributed code and documentation use the project's existing
[MIT License](LICENSE); contribute material you have the right to share under it.
