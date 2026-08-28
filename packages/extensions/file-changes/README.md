# @deepseek-ai/dsh-file-changes

Small Host Remote used by the final produced-files surface to undo one Agent-produced text-file change safely. It does not intercept Agent writes and does not add model-facing tools.

## Model Experience

None. The model keeps using the native Harness file tools. This package is a user-side action service only.

## Installation

The package is a `dsh.bundle`: install it into any dsh profile that loads the base bundle, which supplies the `fs`, `sessions`, and typert services the Remote injects.

- From a packed tarball: `dsh plugin --profile <name> add ./@deepseek-ai-dsh-file-changes-0.1.0-rc.5.tgz`
- From this checkout's source: `pnpm pack` in `packages/extensions/file-changes/`, then add the produced tarball.
- From npm after publication: `dsh plugin --profile <name> add @deepseek-ai/dsh-file-changes`

The package's `cordis.patch.yml` inserts one idle `file-changes` row; it activates only when the profile provides the `fs`, `sessions`, and typert services.

## Dependencies

The bundle requires the base `dsh` installation to provide its peers. The source manifest declares them as `workspace:^`; `pnpm pack` rewrites those to the published version ranges before the tarball ships, so the published package depends only on published registry versions. The plugin never bundles its own copy of the harness services.

## Known Limitations and Deferred Work

- Undo is text-only: it rejects an unresolved target that is not a regular text file, and a created-file or fragment-based undo refuses to proceed when the current content no longer matches the recorded after-image.
- The service activates only inside a profile that supplies the `fs`, `sessions`, and typert services; a profile using a filesystem or session backend without those surfaces leaves the row idle.
- Undo runs under the owning session's resolved sandbox policy, so a produced file must still be writable under that session's workspace root; a denied write surfaces `FS_SANDBOX_DENIED`. The created-file delete path removes the file with a direct unlink and is not policy-fenced.



