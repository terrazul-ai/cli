# CLI Uninstall Feature

- [x] Analyze current install + storage behavior and identify removal targets
- [x] Add unit tests for manifest helpers and dependency pruning logic
- [x] Add integration/E2E coverage for `tz uninstall`
- [x] Implement uninstall command logic, manifest updates, and lock pruning
- [x] Ensure project docs/state files are refreshed (lockfile, TERRAZUL.md)
- [x] Run lint, build, and full test suite to verify changes

## Follow-up (2025-09-17)

- [x] Prevent uninstall from removing packages still required by other installed packages
- [x] Add regression tests covering protected dependents during uninstall
