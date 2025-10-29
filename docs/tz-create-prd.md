# PRD: `tz create` Command

## Overview

Add a new `tz create` command that scaffolds a blank publishable package through an interactive Ink-based wizard. The command creates the necessary directory structure, manifest, and supporting files for package authors to start building their AI agent configurations.

---

## Goals

- Provide a guided, interactive experience for creating new packages
- Mirror the UX patterns established by `tz extract` (Ink wizard, step-by-step flow)
- Generate a valid package structure that passes `tz validate`
- Auto-populate package scope from user profile when available
- Support all current tool types: `claude`, `codex`, `cursor`, `copilot`

## Non-Goals (v1)

- Non-interactive mode (flags only)
- Git integration (no `git init`, no initial commit)
- Template selection (blank scaffold only)
- Example/sample content (empty directories only)
- Post-creation validation (user runs `tz validate` manually)

---

## Command Specification

### Syntax

```bash
tz create [name]
```

### Arguments

- `name` (optional): Package name in format `@scope/package-name` or `package-name`
  - If omitted, wizard prompts for it
  - Scope defaults to username from active profile (`@username/...`)
  - If no profile, prompts for full scoped name

### Options (v1)

```bash
--dry-run        # Preview structure without writing files
```

### Future Options (not v1)

```bash
--description    # Skip description prompt
--license        # Skip license prompt
--tools          # Comma-separated tool list
--no-interactive # Require all flags, skip wizard
```

---

## Sample Flows

### Flow 1: Happy Path (User with Profile)

**Context:** User `alice` is logged in with profile username configured

```bash
$ tz create

╔════════════════════════════════════════════════════════╗
║  Create • 1/4 • Package Metadata                       ║
╠════════════════════════════════════════════════════════╣
║  Define your package identity                          ║
╚════════════════════════════════════════════════════════╝

Package name: @alice/my-agents_
Description: _
License: MIT_

Tab/Shift+Tab: next/previous • Enter: continue • Esc: cancel
```

_User types description and presses Enter_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 2/4 • Tool Compatibility                     ║
╠════════════════════════════════════════════════════════╣
║  Select which AI tools can use this package            ║
╚════════════════════════════════════════════════════════╝

  ☐ claude
  ☐ codex
  ☐ cursor
  ☐ copilot

Space: toggle • A: all • N: none • ↑↓: navigate • Enter: continue
```

_User selects claude and cursor with Space, presses Enter_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 3/4 • Options                                ║
╠════════════════════════════════════════════════════════╣
║  Configure package creation                            ║
╚════════════════════════════════════════════════════════╝

  ☐ Include example agents/commands
  ☐ Include hooks/ directory

Space: toggle • ↑↓: navigate • Enter: continue
```

_User leaves both unchecked, presses Enter_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 4/4 • Review & Confirm                       ║
╠════════════════════════════════════════════════════════╣
║  Review your package configuration                     ║
╚════════════════════════════════════════════════════════╝

Package
  Name: @alice/my-agents
  Version: 0.0.0
  License: MIT
  Description: My custom AI agent configurations

Tools • 2 selected
  ✓ claude
  ✓ cursor

Structure
  ./my-agents/
  ├── agents.toml
  ├── README.md
  ├── .gitignore
  ├── agents/
  ├── commands/
  ├── configurations/
  └── mcp/

Enter: create package • Shift+Tab: back • Esc: cancel
```

_User presses Enter_

```bash
⠋ Creating package…

✓ Created ./my-agents/
✓ Created agents.toml
✓ Created README.md
✓ Created .gitignore
✓ Created agents/ (empty)
✓ Created commands/ (empty)
✓ Created configurations/ (empty)
✓ Created mcp/ (empty)

Package created at ./my-agents

Next steps:
  cd my-agents

  Add your content:
  - agents/ — Agent definitions
  - commands/ — Custom commands
  - configurations/ — Config files

  Test locally:
  tz link

  Publish when ready:
  tz validate
  tz publish
```

---

### Flow 2: User Without Profile

**Context:** User not logged in or no username in profile

```bash
$ tz create

╔════════════════════════════════════════════════════════╗
║  Create • 1/4 • Package Metadata                       ║
╠════════════════════════════════════════════════════════╣
║  Define your package identity                          ║
╚════════════════════════════════════════════════════════╝

Package name: @local/cli_
Description: _
License: MIT_

Tab/Shift+Tab: next/previous • Enter: continue • Esc: cancel
```

_User changes name to `@bob/awesome-agents`, fills in description, continues..._

```bash
[... rest of wizard ...]

Package created at ./awesome-agents

Next steps:
  cd awesome-agents
  [...]
```

---

### Flow 3: Pre-filled Name via Argument

**Context:** User provides package name upfront

```bash
$ tz create @charlie/productivity-tools

╔════════════════════════════════════════════════════════╗
║  Create • 1/4 • Package Metadata                       ║
╠════════════════════════════════════════════════════════╣
║  Define your package identity                          ║
╚════════════════════════════════════════════════════════╝

Package name: @charlie/productivity-tools
Description: _
License: MIT_

Tab/Shift+Tab: next/previous • Enter: continue • Esc: cancel
```

_Name field is pre-filled but editable; user continues through wizard..._

---

### Flow 4: Select All Tools

**Context:** User wants to support all tools

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 2/4 • Tool Compatibility                     ║
╠════════════════════════════════════════════════════════╣
║  Select which AI tools can use this package            ║
╚════════════════════════════════════════════════════════╝

  ☐ claude
  ☐ codex
  ☐ cursor
  ☐ copilot

Space: toggle • A: all • N: none • ↑↓: navigate • Enter: continue
```

_User presses 'A' key_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 2/4 • Tool Compatibility                     ║
╠════════════════════════════════════════════════════════╣
║  Select which AI tools can use this package            ║
╚════════════════════════════════════════════════════════╝

  ☑ claude
  ☑ codex
  ☑ cursor
  ☑ copilot

Space: toggle • A: all • N: none • ↑↓: navigate • Enter: continue
```

_All tools now selected, continues..._

---

### Flow 5: Dry Run Mode

**Context:** User wants to preview without creating files

```bash
$ tz create --dry-run

[... goes through entire wizard ...]

╔════════════════════════════════════════════════════════╗
║  Create • 4/4 • Review & Confirm                       ║
╠════════════════════════════════════════════════════════╣
║  Review your package configuration                     ║
╚════════════════════════════════════════════════════════╝

Package
  Name: @alice/test-package
  Version: 0.0.0
  License: MIT
  Description: Testing dry run

Tools • 1 selected
  ✓ claude

Structure
  ./test-package/
  ├── agents.toml
  ├── README.md
  ├── .gitignore
  ├── agents/
  ├── commands/
  ├── configurations/
  └── mcp/

⚠ DRY RUN MODE — No files will be written

Enter: preview (no changes) • Shift+Tab: back • Esc: cancel
```

_User presses Enter_

```bash
DRY RUN: Would create package at ./test-package

Would create:
  ./test-package/agents.toml
  ./test-package/README.md
  ./test-package/.gitignore
  ./test-package/agents/
  ./test-package/commands/
  ./test-package/configurations/
  ./test-package/mcp/

No changes made.
```

---

### Flow 6: Include Optional Features

**Context:** User wants example content and hooks directory

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 3/4 • Options                                ║
╠════════════════════════════════════════════════════════╣
║  Configure package creation                            ║
╚════════════════════════════════════════════════════════╝

  ☐ Include example agents/commands
  ☐ Include hooks/ directory

Space: toggle • ↑↓: navigate • Enter: continue
```

_User presses Space twice to enable both options_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 3/4 • Options                                ║
╠════════════════════════════════════════════════════════╣
║  Configure package creation                            ║
╚════════════════════════════════════════════════════════╝

  ☑ Include example agents/commands
  ☑ Include hooks/ directory

Space: toggle • ↑↓: navigate • Enter: continue
```

_Continues to preview..._

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 4/4 • Review & Confirm                       ║
╠════════════════════════════════════════════════════════╣
║  Review your package configuration                     ║
╚════════════════════════════════════════════════════════╝

[...]

Structure
  ./my-agents/
  ├── agents.toml (with example comments)
  ├── README.md
  ├── .gitignore
  ├── agents/
  ├── commands/
  ├── configurations/
  ├── hooks/
  └── mcp/

Enter: create package • Shift+Tab: back • Esc: cancel
```

---

### Flow 7: User Cancels Mid-Wizard

**Context:** User decides not to continue

```bash
$ tz create

╔════════════════════════════════════════════════════════╗
║  Create • 1/4 • Package Metadata                       ║
╠════════════════════════════════════════════════════════╣
║  Define your package identity                          ║
╚════════════════════════════════════════════════════════╝

Package name: @alice/my-agents_
Description: _
License: MIT_

Tab/Shift+Tab: next/previous • Enter: continue • Esc: cancel
```

_User presses Esc_

```bash
Cancelled.
```

_Exit code 1, no files created_

---

### Flow 8: Double Ctrl+C Exit

**Context:** User wants immediate exit without confirmation

```bash
$ tz create

[... in wizard ...]
```

_User presses Ctrl+C once_

```bash
⚠ Press Ctrl+C again to exit
```

_User presses Ctrl+C again within 1.5 seconds_

```bash
Cancelled.
```

_Exits immediately, no files created_

---

### Flow 9: Directory Already Exists Error

**Context:** Target directory already exists

```bash
$ tz create @alice/existing-package

[... goes through wizard ...]

⠋ Creating package…

✗ Error: Directory './existing-package' already exists and is not empty.

Cancelled.
```

_Exit code 1_

---

### Flow 10: No Tools Selected

**Context:** User creates tool-agnostic package

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 2/4 • Tool Compatibility                     ║
╠════════════════════════════════════════════════════════╣
║  Select which AI tools can use this package            ║
╚════════════════════════════════════════════════════════╝

  ☐ claude
  ☐ codex
  ☐ cursor
  ☐ copilot

Space: toggle • A: all • N: none • ↑↓: navigate • Enter: continue
```

_User presses Enter without selecting any_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 4/4 • Review & Confirm                       ║
╠════════════════════════════════════════════════════════╣
║  Review your package configuration                     ║
╚════════════════════════════════════════════════════════╝

Package
  Name: @alice/generic-package
  Version: 0.0.0
  License: MIT

Tools • None selected

Structure
  ./generic-package/
  [...]

Enter: create package • Shift+Tab: back • Esc: cancel
```

_Results in agents.toml without [compatibility] section_

---

### Flow 11: Navigation - Going Back to Edit

**Context:** User realizes they made a mistake and goes back

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 4/4 • Review & Confirm                       ║
╠════════════════════════════════════════════════════════╣
║  Review your package configuration                     ║
╚════════════════════════════════════════════════════════╝

Package
  Name: @alice/wrong-name
  Version: 0.0.0
  License: MIT
  Description: Oops wrong name

[...]

Enter: create package • Shift+Tab: back • Esc: cancel
```

_User presses Shift+Tab_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 3/4 • Options                                ║
╠════════════════════════════════════════════════════════╣
║  Configure package creation                            ║
╚════════════════════════════════════════════════════════╝

[...]
```

_User continues pressing Shift+Tab to go back to metadata step_

```bash
╔════════════════════════════════════════════════════════╗
║  Create • 1/4 • Package Metadata                       ║
╠════════════════════════════════════════════════════════╣
║  Define your package identity                          ║
╚════════════════════════════════════════════════════════╝

Package name: @alice/wrong-name_
Description: Oops wrong name_
License: MIT_

Tab/Shift+Tab: next/previous • Enter: continue • Esc: cancel
```

_User edits name, navigates forward again with Tab/Enter_

---

## Wizard Flow

### Step 1: Metadata (3 fields)

**Prompt fields:**

1. **Package name** (TextInput)
   - Default: `@{username}/{cwd-basename}` if profile username exists, else `@local/{cwd-basename}`
   - Validation: none in wizard (just accept input)
   - Example: `@alice/my-agents`

2. **Description** (TextInput, optional)
   - Default: empty string
   - User can skip with Enter
   - Example: "My custom AI agent configurations"

3. **License** (TextInput)
   - Default: `MIT`
   - Pre-filled, user can change
   - Example: `MIT`, `Apache-2.0`, `ISC`

**Navigation:**

- Tab/Shift+Tab: cycle between fields
- Enter: proceed to next step

---

### Step 2: Tools (multi-select list)

**Selection list:**

```
☐ claude
☐ codex
☐ cursor
☐ copilot
```

**Controls:**

- Space: toggle current item
- A: select all
- N: clear all
- Up/Down: navigate
- Enter: continue

**Default state:** All unchecked (user selects what they want)

**Result:** Selected tools are added to `[compatibility]` section in agents.toml

---

### Step 3: Options (toggle list)

**Toggle options:**

```
☐ Include example agents/commands
☐ Include hooks/ directory
```

**Controls:**

- Space: toggle current item
- Up/Down: navigate
- Enter: continue

**Defaults:** All unchecked

**Notes:**

- Example option adds commented-out sample content to agents.toml
- Hooks option determines whether to create empty `hooks/` dir

---

### Step 4: Preview & Confirm

**Display:**

1. Package metadata summary
2. Selected tools
3. Directory structure tree
4. Destination path

**Example:**

```
Package
  Name: @alice/my-agents
  Version: 0.0.0
  License: MIT
  Description: My custom AI agent configurations

Tools
  ✓ claude
  ✓ cursor

Structure
  ./my-agents/
  ├── agents.toml
  ├── README.md
  ├── .gitignore
  ├── agents/
  ├── commands/
  ├── configurations/
  ├── hooks/ (if enabled)
  └── mcp/

Enter: create package • Shift+Tab: back • Esc: cancel
```

**Controls:**

- Enter: execute creation
- Shift+Tab: go back to options
- Esc: cancel and exit

---

### Step 5: Execute

**Progress indicator:**

```
⠋ Creating package…

✓ Created ./my-agents/
✓ Created agents.toml
✓ Created README.md
✓ Created .gitignore
✓ Created agents/ (empty)
✓ Created commands/ (empty)
✓ Created configurations/ (empty)
✓ Created mcp/ (empty)

Package created at ./my-agents

Next steps:
  cd my-agents

  Add your content:
  - agents/ — Agent definitions
  - commands/ — Custom commands
  - configurations/ — Config files

  Test locally:
  tz link

  Publish when ready:
  tz validate
  tz publish
```

---

## Output Structure

### Directory Layout

**Always created:**

```
{package-name}/
├── agents.toml          # Manifest with [package], [compatibility]
├── README.md            # Basic template
├── .gitignore           # Ignore agent_modules/, node_modules/, etc.
├── agents/              # Empty directory
├── commands/            # Empty directory
├── configurations/      # Empty directory
└── mcp/                 # Empty directory
```

**Optionally created:**

```
└── hooks/               # Only if enabled in options step
```

---

### File Templates

#### agents.toml

```toml
[package]
name = "@alice/my-agents"
version = "0.0.0"
description = "My custom AI agent configurations"
license = "MIT"

[dependencies]
# Add package dependencies here
# "@terrazul/base" = "^1.0.0"

[compatibility]
# Selected tools from wizard
claude = "*"
cursor = "*"

# [exports]
# Uncomment to define what files to render
# agents = ["agents/*.md"]
# commands = ["commands/*.sh"]

# [profiles]
# Uncomment to define installation profiles
# default = ["@alice/my-agents"]
```

#### README.md

```markdown
# {package-name}

{description}

## Installation

\`\`\`bash
tz add {package-name}
\`\`\`

## Usage

Add usage instructions here.

## Development

\`\`\`bash

# Link for local development

tz link

# Validate package structure

tz validate

# Publish when ready

tz publish
\`\`\`

## License

{license}
```

#### .gitignore

```
node_modules/
agent_modules/
.DS_Store
*.tgz
dist/
```

---

## Implementation Architecture

### Command Handler

**File:** `src/commands/create.tsx`

```typescript
export function registerCreateCommand(
  program: Command,
  createCtx: (opts: { verbose?: boolean }) => CLIContext,
): void {
  program
    .command('create [name]')
    .description('Create a new Terrazul package scaffold')
    .option('--dry-run', 'Preview structure without writing files', false)
    .action(async (name?: string, options?: { dryRun?: boolean }) => {
      const ctx = createCtx({ verbose: program.opts().verbose });

      // Build base options from args + profile
      const baseOptions = await buildCreateBaseOptions(name, options, ctx);

      // Run interactive wizard
      const { result } = await runCreateWizard(baseOptions, ctx);

      if (result && !options.dryRun) {
        ctx.logger.info(`Package created at ${result.targetDir}`);
      }
    });
}
```

### Wizard Component

**File:** `src/ui/create/CreateWizard.tsx`

```typescript
export interface CreateWizardProps {
  baseOptions: CreateOptions;
  execute: (options: CreateOptions) => Promise<CreateResult>;
  logger: LoggerLike;
  onComplete?: (result: CreateResult) => void;
  onCancel?: () => void;
}

export function CreateWizard({
  baseOptions,
  execute,
  logger,
  onComplete,
  onCancel,
}: CreateWizardProps): React.ReactElement {
  // State machine: metadata → tools → options → preview → executing → completed
  // Reuse components from extract: WizardFrame, SelectableList, LogPanel
}
```

**Steps enum:**

```typescript
type CreateStep = 'metadata' | 'tools' | 'options' | 'preview';
```

### Core Business Logic

**File:** `src/core/package-creator.ts`

```typescript
export interface CreateOptions {
  name: string; // @alice/my-agents
  description: string; // Optional description
  license: string; // Default: MIT
  version: string; // Default: 0.0.0
  targetDir: string; // ./my-agents
  tools: string[]; // ['claude', 'cursor']
  includeExamples: boolean; // Add example comments to manifest
  includeHooks: boolean; // Create hooks/ directory
  dryRun: boolean;
}

export interface CreateResult {
  created: string[]; // List of created file paths
  targetDir: string; // Absolute path to package root
  summary: {
    packageName: string;
    version: string;
    toolCount: number;
    fileCount: number;
  };
}

export async function createPackageScaffold(
  options: CreateOptions,
  logger: Logger,
): Promise<CreateResult> {
  // 1. Derive target directory from package name
  // 2. Check if directory already exists (error if not dryRun and not empty)
  // 3. Create directory structure
  // 4. Generate agents.toml from template
  // 5. Generate README.md from template
  // 6. Create .gitignore
  // 7. Create empty subdirectories
  // 8. Return result
}
```

**Helper functions:**

```typescript
// Strip scope prefix from package name
// @alice/my-agents → my-agents
// my-package → my-package
function getPackageDirName(packageName: string): string;

// Generate agents.toml content
function generateManifest(options: CreateOptions): string;

// Generate README.md content
function generateReadme(options: CreateOptions): string;

// Get default package name from cwd + profile
async function deriveDefaultPackageName(ctx: CLIContext): Promise<string>;
```

---

## Testing Strategy

### Unit Tests

**File:** `tests/unit/core/package-creator.test.ts`

- `createPackageScaffold()` with minimal options
- `createPackageScaffold()` with all tools selected
- `createPackageScaffold()` in dry-run mode
- `getPackageDirName()` with scoped/unscoped names
- `generateManifest()` output matches template
- `deriveDefaultPackageName()` with/without profile

### Integration Tests

**File:** `tests/integration/create.test.ts`

- Full wizard flow with mocked prompts
- Verify all files created correctly
- Verify agents.toml parses correctly
- Verify directory is created at expected location
- Error when target directory already exists
- Dry-run mode doesn't write files

### UI Tests

**File:** `tests/ui/create-wizard.test.tsx`

- Renders metadata step correctly
- Renders tools selection list
- Navigation between steps (Tab, Enter, Shift+Tab)
- Tool toggle with Space
- Select all/clear all (A/N keys)
- Preview step shows correct summary
- Cancel with Esc

---

## Edge Cases & Validation

### During Wizard

- **No validation** on package name format (accept any input)
- **No validation** on version format (accept any input)
- Empty description allowed
- No tools selected → creates manifest without [compatibility] section

### Before Execution

- Target directory exists and not empty → error (unless `--force` in future)
- Package name empty → error
- Invalid characters in directory name → sanitized automatically

### After Creation

- User runs `tz validate` manually to check package structure
- User adds content before publishing

---

## Error Handling

### Directory Conflict

```
Error: Directory './my-agents' already exists and is not empty.
       Use --force to overwrite (not implemented in v1).
```

### File System Errors

```
Error: Permission denied creating directory './my-agents'
```

---

## Key Decisions & Rationale

| Decision                | Rationale                                           |
| ----------------------- | --------------------------------------------------- |
| No git integration      | Keep scope small; most users already in git repos   |
| No validation in wizard | Let user add content first; validate before publish |
| Default version 0.0.0   | Matches extract; signals "not ready for publish"    |
| Auto-scope from profile | Reduces friction for logged-in users                |
| Tools optional          | Some packages may be tool-agnostic                  |
| Empty directories only  | Package authors need clean slate                    |
| Interactive-only (v1)   | Mirrors extract; can add flags later                |

---

## Future Enhancements (Post-v1)

1. **Non-interactive mode:** `tz create --name @alice/pkg --yes`
2. **Template selection:** `tz create --template starter`
3. **Git integration:** `--git` flag to auto-init and commit
4. **Post-creation validation:** Auto-run `tz validate`
5. **Example content:** `--examples` to include sample agents
6. **Directory prompt:** Let user choose location instead of deriving
7. **Version constraint templates:** Per-tool version ranges

---

## Acceptance Criteria

- [ ] Command `tz create` launches interactive wizard
- [ ] Wizard has 4 steps: metadata → tools → options → preview
- [ ] Package name defaults to `@{username}/{cwd}` from profile
- [ ] Tool selection supports claude, codex, cursor, copilot
- [ ] Directory created at `./{package-name}` (scope stripped)
- [ ] agents.toml generated with selected tools in [compatibility]
- [ ] README.md generated with package metadata
- [ ] Empty directories created: agents/, commands/, configurations/, mcp/
- [ ] Optional hooks/ directory if enabled
- [ ] .gitignore created with standard ignores
- [ ] Dry-run mode previews without writing files
- [ ] Error if target directory exists
- [ ] Success message shows next steps
- [ ] All unit, integration, and UI tests pass
- [ ] Zero lint errors, formatted with prettier
- [ ] Documentation updated in CLAUDE.md

---

## Documentation Updates

### CLAUDE.md

Add to command list:

```markdown
- `tz create [name]` – Interactive wizard to scaffold a new package
  - Prompts for metadata, tool selection, options
  - Creates directory structure and manifest
  - Outputs ready-to-edit package scaffold
```

### Help Text

```
tz create [name]

Create a new Terrazul package scaffold

Arguments:
  name                    Package name (@scope/name)

Options:
  --dry-run              Preview structure without writing files
  -h, --help             Display help for command

Examples:
  tz create                    # Interactive wizard with defaults
  tz create @alice/my-agents   # Pre-fill package name
  tz create --dry-run          # Preview without creating
```

---

## Dependencies

**No new runtime dependencies** (reuse existing):

- `ink` (already present)
- `inquirer` (for potential future non-interactive prompts)
- `commander` (CLI framework)

**Reuse UI components from extract:**

- `WizardFrame`
- `SelectableList`
- `LogPanel`
- `useExtractWizardState` pattern → adapt to `useCreateWizardState`

---

## Implementation Checklist

1. **Core logic** (`src/core/package-creator.ts`)
   - [ ] `CreateOptions` / `CreateResult` types
   - [ ] `createPackageScaffold()` function
   - [ ] `generateManifest()` helper
   - [ ] `generateReadme()` helper
   - [ ] `getPackageDirName()` helper
   - [ ] `deriveDefaultPackageName()` helper

2. **Wizard state** (`src/ui/create/create-wizard-state.ts`)
   - [ ] State machine with 4 steps
   - [ ] Actions for navigation, tool toggle, field updates
   - [ ] Mirror pattern from `extract-wizard-state.ts`

3. **Wizard UI** (`src/ui/create/CreateWizard.tsx`)
   - [ ] Metadata step with TextInput fields
   - [ ] Tools step with SelectableList
   - [ ] Options step with toggles
   - [ ] Preview step with summary
   - [ ] Execute step with spinner + progress
   - [ ] Keyboard handlers (Enter, Tab, Space, A, N, Esc)

4. **Command handler** (`src/commands/create.tsx`)
   - [ ] Register command with commander
   - [ ] Build base options
   - [ ] Launch wizard
   - [ ] Handle result/cancellation

5. **Tests**
   - [ ] Unit tests for core logic
   - [ ] Integration tests for full flow
   - [ ] UI tests for wizard components
   - [ ] Snapshot tests for generated files

6. **Quality gates**
   - [ ] `pnpm run build` succeeds
   - [ ] `pnpm run typecheck` passes
   - [ ] `pnpm run lint:fix` cleans code
   - [ ] `pnpm run format` applied
   - [ ] `pnpm test` all pass

7. **Documentation**
   - [ ] Update CLAUDE.md command list
   - [ ] Add help text to command
   - [ ] Update README if needed

---

Ready to implement! 🚀
