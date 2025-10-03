# Template Renderer Symlink Safety

## Summary

- Goal: prevent tz template application from writing outside the project root via symlinked destinations.
- Owner: Codex Assistant (GPT-5)
- Date Started: 2025-09-16

## Tasks

- [x] Confirm existing renderer behavior and identify write points
- [x] Implement destination symlink safety guard within renderer
- [x] Ensure apply/install/update surface meaningful feedback for security skips
- [x] Add unit tests covering symlink-outside, symlink-inside, and ancestor scenarios
- [x] Run focused unit suite for template renderer

## Notes

- Keep skip/error messaging actionable for CLI users
- Avoid breaking legitimate in-repo symlink workflows (unlink + replace expected)
