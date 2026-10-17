# Release preparation

Sheco can publish its source independently of distributing installers. The current repository has
an MIT license and an unsigned CI packaging workflow.
[The repository](https://github.com/shecof/Sheco) is public.
Releases are uploaded manually. CI artifacts remain unsigned; macOS release signing and
notarization use a local Developer ID identity and a notarytool Keychain profile.

## Publish source

1. Verify repository, issue tracker, and release links in the README and package metadata.
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

Set the intended application version in `package.json` and the root package entries in
`package-lock.json` before building. Update both README download tables to match the tag and
artifact names. Runtime UI and MCP version reporting use `app.getVersion()`; do not hardcode
a separate release number in source. Keep `plugins/README.md`, plugin guides and synthetic
screenshots current, and review every staged file before committing.
Publish a stable release with a matching `vMAJOR.MINOR.PATCH` tag, such as `v1.0.1`, and leave
GitHub's draft/prerelease flags off. The manual in-app checker compares `app.getVersion()` with
the [latest stable release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
for this repository. It ignores drafts/prereleases, compares versions numerically and opens
the matching release page only on request; it does not download or install updates. Publishing
a release still requires explicit authorization; adding the checker does not publish a version.

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

For a trusted public binary release, use macOS Developer ID signing and notarization and
Windows code signing in an appropriate protected release environment. Validate the signatures
and installation behavior. Label intentionally unsigned Windows artifacts clearly.
See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing).

## Sign and notarize macOS releases

Install a **Developer ID Application** certificate with its matching private key in the build
machine's Keychain. An Apple Development or Mac App Store certificate does not replace it for
distribution through GitHub. Keep private keys, certificate exports, and authentication material
outside the repository and release assets.

Create a local notarytool profile interactively; enter credentials at its prompts, rather than in
shell history, documentation, or environment files:

```sh
xcrun notarytool store-credentials sheco-notary
xcrun notarytool history --keychain-profile sheco-notary
```

Build with the validated profile and require a signing identity:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=true APPLE_KEYCHAIN_PROFILE=sheco-notary \
  npm run dist:mac -- --config.forceCodeSigning=true --config.dmg.sign=true \
  '--config.mac.signIgnore=\.pak$'
```

If multiple Developer ID identities are installed, select the intended team explicitly with
`--config.mac.identity="Developer Name (TEAMID)"`. Keep hardened runtime enabled. Check the build
log for successful notarization of both architectures; `forceCodeSigning` requires a signature
but does not require notarization when credentials are absent. Do not upload a build that only
reports skipped notarization.

The `signIgnore` rule skips separate signatures on Chromium localization/resource `.pak` files,
which are data rather than executable code. Their integrity remains covered by the enclosing
bundle's resource seal. This avoids repeatedly signing the same localization resources through
Electron framework symlinks. Executables, frameworks, libraries, and helper apps remain signed.

Verify each final app with `codesign --verify --deep --strict`, `spctl --assess --type execute`,
and `xcrun stapler validate`. DMGs can also be submitted to notarytool and stapled so their ticket
is available without a network connection. Run signature and ticket checks before calculating
the final checksums. ZIP files contain the signed, stapled app; ZIP files themselves do not
support stapling.

See [Apple's Developer ID instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
and [notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

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

## Publish the verified release

After explicit publication authorization, push the reviewed source commit to the repository and
wait for its macOS/Windows CI results. Create the matching version tag on that exact commit.
Prepare release notes covering user-visible changes, signing, actual checks and remaining
platform limits; link the CI run. Upload the six platform artifacts, their final `SHA256SUMS.txt`
and a `BUILD-INFO.json` identifying the commit, tool versions, checks and artifact hashes.
Keep signing credentials, internal logs and unpacked app directories out of release assets.

Prepare a draft while files upload, verify its asset names, sizes and checksums, then publish
as a stable release and mark it latest. Confirm both README download tables resolve and that
the latest-stable API returns the intended tag. Leave previous releases and local builds intact.
