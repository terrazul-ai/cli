# Research Terrazul CLI Codebase

You are tasked with conducting comprehensive research across the Terrazul CLI repository to answer user questions thoroughly and systematically.

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY

- DO NOT suggest improvements or changes unless the user explicitly asks for them
- DO NOT perform root cause analysis unless the user explicitly asks for them
- DO NOT propose future enhancements unless the user explicitly asks for them
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact
- You are creating a technical map/documentation of the existing system

## Terrazul CLI Context

This repository contains a Node.js + TypeScript command-line tool that manages AI agent configuration packages. Key domains include:

- **Functional Core / Imperative Shell**: Thin `commands/` for I/O; business logic in `core/`; pure helpers in `utils/`
- **Command Structure**: CLI commands registered in `src/index.ts` using Commander.js framework
- **Core Business Logic**: `src/core/` contains testable modules (storage, registry-client, dependency-resolver, lock-file, etc.)
- **Package Management**: Content-addressable cache, SAT-based dependency resolution, integrity verification
- **Integrations**: Tool-specific adapters (e.g., Claude Code MCP) via symlinks and settings merge
- **Testing**: Vitest with unit, integration, and e2e test suites using dummy registry

## Initial Setup

When this command is invoked, respond with:

```
I'm ready to research the Terrazul CLI repository. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.

Key areas I can investigate:
- Command structure and CLI orchestration
- Core business logic (storage, registry, resolver, lockfile)
- Package management and dependency resolution
- Integration adapters and tool-specific features
- Testing patterns and dummy registry setup
- Build and distribution pipeline (esbuild, SEA binaries)
```

Then wait for the user's research query.
If the invocation already includes a research question or file path, skip the default prompt above and proceed directly to the steps below.

## Steps to follow after receiving the research query

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (tickets, docs, JSON), read them FULLY first
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself to establish full context before beginning research
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Take time to think about the underlying patterns, connections, and architectural implications the user might be seeking
   - Identify specific components, patterns, or concepts to investigate
   - Create a research plan using TodoWrite (or track subtasks manually if TodoWrite is unavailable)
   - Consider which directories, files, or architectural patterns are relevant

3. **Conduct systematic codebase research:**
   - Read files to understand HOW implementations work (without critique)
   - Explore directory structures and look for related docs in `agent_files/`

4. **Analyze and synthesize findings:**
   - Compile all research results from codebase exploration
   - Prioritize live codebase findings as primary source of truth
   - Use any agent_files/ documentation as supplementary historical context
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Gather metadata for the research document:**
   - Get current git information: branch, commit hash
   - Filename: `agent_files/research/YYYY-MM-DD-ENG-XXXX-description.md`
     - Format: `YYYY-MM-DD-ENG-XXXX-description.md` where:
       - YYYY-MM-DD is today's date
       - ENG-XXXX is the ticket number (omit if no ticket)
       - description is a brief kebab-case description of the research topic
     - Examples:
       - With ticket: `2025-01-08-ENG-1478-auth-flow.md`
       - Without ticket: `2025-01-08-image-generation-pipeline.md`

6. **Generate research document:**
   - Use the metadata gathered in step 5
   - Structure the document with YAML frontmatter followed by content:

     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: [Researcher name from thoughts status]
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: [Repository name]
     topic: "[User's Question/Topic]"
     tags: [research, codebase, relevant-component-names]
     status: complete
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Researcher name]
     ---

     # Research: [User's Question/Topic]

     **Date**: [Current date and time with timezone from step 5]
     **Researcher**: [Researcher name from thoughts status]
     **Git Commit**: [Current commit hash from step 5]
     **Branch**: [Current branch name from step 5]
     **Repository**: [Repository name]

     ## Research Question

     [Original user query]

     ## Summary

     [High-level documentation of what was found, answering the user's question by describing what exists]

     ## Detailed Findings

     ### [Component/Area 1]

     - Description of what exists ([file.ext:line](link))
     - How it connects to other components
     - Current implementation details (without evaluation)

     ### [Component/Area 2]

     ...

     ## Code References

     - `path/to/file.ts:45-67` - Description of the code block
     - `another/file.tsx:12-34` - Description of what's there

     ## Architecture Documentation

     [Current patterns, conventions, and design implementations found in the codebase]

     ## Historical Context (from agent_files/)

     [Relevant insights from agent_files/ directory with references]

     - `agent_files/docs/something.md` - Historical decision about X

     ## Related Research

     [Links to other research documents in agent_files/research/]

     ## Open Questions

     [Any areas that need further investigation]
     ```

7. **Present findings:**
   - Present a concise summary of findings to the user
   - Include key file references for easy navigation
   - Save detailed research to `agent_files/research/` if the research is comprehensive
   - Ask if they have follow-up questions or need clarification

8. **Handle follow-up questions:**
   - If the user has follow-up questions, continue investigating
   - Update any saved research documents with new findings
   - Add new sections for follow-up research as needed

## Terrazul CLI Specific Research Areas

### Commands Layer

- **Architecture**: Commander.js framework with thin orchestration in `src/commands/`
- **Commands**: `src/commands/` (e.g., `init.ts`, `install.ts`, `publish.ts`, `run.ts`, `apply.ts`)
- **Context**: Dependency injection via `createCLIContext()` from `src/utils/context.ts`
- **Registration**: Commands registered in `src/index.ts` with version and help
- **Testing**: Integration tests in `tests/integration/` with CLI command invocation

### Core Business Logic

- **Storage**: `src/core/storage.ts` with content-addressable cache and SHA-256 verification
- **Registry**: `src/core/registry-client.ts` for API communication with auth headers
- **Resolver**: `src/core/dependency-resolver.ts` using SAT solver (minisat) for deterministic resolution
- **Lockfile**: `src/core/lock-file.ts` for deterministic TOML operations with integrity hashes
- **Errors**: `src/core/errors.ts` with `TerrazulError` taxonomy mapping
- **Testing**: Unit tests in `tests/unit/core/` with pure function testing

### Package Management

- **Manifests**: `agents.toml` and `agents-lock.toml` with TOML parsing via `@iarna/toml`
- **Cache**: Content-addressable storage under `~/.terrazul/cache/sha256/`
- **Extraction**: Safe tar extraction with path traversal and symlink protections
- **Integrity**: SHA-256 verification for all package operations

### Integrations Layer

- **Base**: `src/integrations/base.ts` for common integration patterns
- **Claude Code**: `src/integrations/claude-code.ts` for symlinks and MCP settings merge
- **Detection**: `src/integrations/detector.ts` for tool presence detection
- **Testing**: Integration tests with symlink and settings file validation

### Utilities

- **Config**: `src/utils/config.ts` for `~/.terrazul/config.json` with 0600 perms and Zod validation
- **Auth**: `src/utils/auth.ts` for token management with localhost callback
- **FS**: `src/utils/fs.ts` for cross-platform file operations and symlink/junction fallback
- **Hash**: `src/utils/hash.ts` for hex/base64 helpers
- **Logger**: `src/utils/logger.ts` with verbosity control
- **Testing**: Unit tests in `tests/unit/utils/` for pure helper functions

### Types and Validation

- **API**: `src/types/api.ts` for registry API envelope types
- **Package**: `src/types/package.ts` for package metadata and version info
- **Config**: `src/types/config.ts` for user configuration schemas
- **Validation**: Zod schemas at all boundaries for runtime validation

### Build and Distribution

- **Build**: `build.config.mjs` using esbuild to create single-file ESM bundle `dist/tz.mjs`
- **SEA**: Self-contained executables for Linux/macOS/Windows using Node.js SEA
- **Testing**: Build validation and SEA testing in CI pipeline
- **Registry**: Dummy registry in `tools/dummy-registry.ts` for testing

## Important notes

- Always run fresh codebase research - never rely solely on existing research documents
- The `agent_files/` directory provides historical context to supplement live findings
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Document cross-component connections and how systems interact
- Include temporal context (when the research was conducted)
- **CRITICAL**: You are a documentarian, not an evaluator
- **REMEMBER**: Document what IS, not what SHOULD BE
- **NO RECOMMENDATIONS**: Only describe the current state of the codebase
- **File reading**: Always read mentioned files FULLY (no limit/offset) before beginning research
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before beginning research (step 1)
  - ALWAYS gather metadata before writing documents (step 5 before step 6)
  - NEVER write research documents with placeholder values
- **Frontmatter consistency**:
  - Always include frontmatter at the beginning of research documents
  - Keep frontmatter fields consistent across all research documents
  - Update frontmatter when adding follow-up research
  - Use snake_case for multi-word field names (e.g., `last_updated`, `git_commit`)
  - Tags should be relevant to the research topic and components studied
