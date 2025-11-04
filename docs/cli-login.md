# Terrazul CLI Login Guide

## Overview

The interactive `tz login` command launches a secure browser session, starts a localhost callback server, and records telemetry for both browser and manual authentication flows. A concurrent manual prompt remains available so users can paste tokens without waiting for the callback.

## Accessibility Options

Configure large-text or audio feedback in `~/.terrazul/config.json`:

```jsonc
{
  "accessibility": {
    "largeText": true,
    "audioFeedback": false,
  },
}
```

Large-text renders CLI messages in uppercase. Audio feedback emits a short bell (`\u0007`) after each message.

## Telemetry Events

When telemetry is enabled (`"telemetry": true` in config), the CLI emits lightweight debug events:

- `login_launch`
- `login_manual_prompt`
- `login_manual_invalid`
- `login_manual_failure`
- `login_manual_success`
- `login_callback_success`
- `login_callback_failure`

Events never include raw tokens; payloads only describe the flow (`via: "manual" | "callback"`).

## Smoke Tests

Run the focused smoke tests locally or in CI on all platforms:

```bash
pnpm run test:login-smoke
```

This covers browser callbacks, manual token entry, and permission enforcement for the config directory.

## Troubleshooting

- **Browser did not open**: copy the URL printed with the `[login]` prefix and paste into a browser.
- **Token expired**: `tz whoami` warns when less than 7 days remain; run `tz login` to refresh.
- **Environment tokens**: if `TERRAZUL_TOKEN` is set, `tz logout` revokes the token remotely but retains the environment variable.

## CI/CD Recommendations

- Prefer `TERRAZUL_TOKEN` for pipelines; `tz whoami` explicitly reports when it is active.
- Add `pnpm run test:login-smoke` to cross-platform smoke suites to guard browser + manual flows.
