# Release preparation

Sheco can publish its source independently of distributing installers. The current repository has
an MIT license and an unsigned CI packaging workflow.
[The repository](https://github.com/shecof/Sheco) is currently private and can be made public later.
Automatic release uploads and platform signing/notarization are not configured.

## Publish source

1. Review the repository visibility and enable public access when ready. Verify repository,
   issue tracker, and release links in the README and package metadata.
   `private: true` in `package.json` prevents accidental npm publication; it does not prevent publishing source on GitHub.
2. Confirm the existing MIT license, copyright attribution, and rights to contributed code,
   logo/assets, and sample content. Keep dependency licenses with distributions.
3. Review the exact committed files and history for credentials and personal data. Local workspaces,
   previews, installers, and build output are excluded from Git; ignore rules are not a secret scanner.
4. Run the macOS/Windows workflow on the published repository and examine its results. Configure
   repository settings such as branch protection and private vulnerability reporting. The private
   security contact is already documented in [SECURITY.md](../SECURITY.md).
5. Add a screenshot made from a synthetic demo workspace and useful issue/release links when
   available. Keep both README languages aligned and label the project's maturity honestly.

Changing a private repository to public also exposes its commit history. Review all reachable
commits, authorship metadata, and files before changing visibility. Keep private local notes and
development data outside the published history.

## Prepare a binary release

Install pinned dependencies and verify the source:

```sh
npm ci
npm run check
npm run test:e2e
npm audit --omit=dev
npm audit
```

Choose additional suites from the [testing matrix](development/testing.md). Review dependency findings
in both runtime and packaging tools, record decisions, and test any dependency update. Avoid a
forced automatic fix that changes the packaging toolchain without verifying the result.

Review the updated source preview before preparing release installers. Preserve existing preview
content. See [development](development/development.md).

Build the appropriate artifacts on the target platform:

```sh
npm run dist:mac   # macOS DMG/ZIP for arm64 and x64
npm run dist:win   # Windows NSIS installer/ZIP
```

Both scripts use `--publish never`. `npm run pack` produces a runnable app directory for the
current OS. Platform icons in `build/` are committed packaging inputs; `npm run icons` regenerates
them from `icon.svg` (macOS `iconutil` is needed for `.icns`). Builds regenerate the ignored
`build/THIRD_PARTY_NOTICES.txt` and bundle it with `LICENSE`.

## Local artifact layout

The packaging commands use `scripts/package.mjs` to reserve a new directory under `release/`:
`YYYY-MM-DD-mac` or `YYYY-MM-DD-win`, using the build machine's local calendar date. A later build
on the same day uses `-02`, `-03`, and so on. Directory creation is exclusive, so concurrent builds
cannot choose the same output directory. A failed build keeps its folder and any diagnostic output.

Keep each build's installers, ZIPs, block maps, unpacked applications, checksums, and provenance
together. The root of `release/` holds a local README index, not loose installers. Do not use
descriptive suffixes such as `-updated`, or overwrite a previous build to reuse its name.
An explicit `--config.directories.output=...` is still supported; choose a new directory when
using it. Direct `electron-builder` invocations also need an explicit output directory.

For a trusted public binary release, configure macOS Developer ID signing and notarization and
Windows code signing in an appropriate protected release environment. Validate the signatures
and installation behavior. Label any intentionally unsigned evaluation artifacts clearly.
See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing).

## Verify the artifacts

- Test installation, launch, editing/saving, export, and restart on Windows and both macOS
  architectures. Packaging on a Mac does not prove Windows runtime behavior or Intel execution.
- The smoke suite can launch a packaged executable through `SHECO_TEST_EXECUTABLE`; it still
  uses a temporary profile. Follow its existing script contract and do not point tests at user data.
- Check the version, included application/license files, archive integrity, signatures, and
  notarization where applicable. Generate and verify SHA-256 checksums for distributed artifacts.
- Record actual results, operating systems/architectures, warnings, and limits in the release
  notes. Link to the corresponding CI run and identify the final artifact revision.

## Current CI scope

[desktop.yml](../.github/workflows/desktop.yml) installs with `npm ci`, runs `check` and `test:e2e`
on macOS and Windows, packages the platform, and uploads CI artifacts. macOS automatic identity
discovery is disabled. The workflow does not publish releases, configure signing/notarization,
run every specialized review suite, or independently prove both macOS architectures.
CI artifact screenshots come from synthetic smoke-test data; review them before public reuse.
