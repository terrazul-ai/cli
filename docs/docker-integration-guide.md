# Docker Integration Guide

This guide explains how to run Docker containers in your Jira webhook workflows to process issues with Claude, Codex, or custom tools.

## Overview

Using Docker gives you:

- **Consistent environment** across all runs
- **Pre-installed dependencies** (Claude, Codex, tools)
- **Isolation** from the GitHub Actions runner
- **Reproducibility** - same image runs everywhere
- **Version control** of your processing environment

## Architecture

```
┌──────┐     webhook     ┌────────────────┐
│ Jira │ ───────────────>│ GitHub Actions │
└──────┘                 └────────────────┘
   ^                            │
   │                            │ pulls image
   │                            ▼
   │                     ┌──────────────┐
   │                     │ Docker Image │
   │                     │ (your-image) │
   │                     └──────────────┘
   │                            │
   │                            │ mounts /workspace
   │                            │ passes env vars
   │                            ▼
   │                     ┌──────────────┐
   │                     │   Container  │
   │                     │   - Claude   │
   │                     │   - Codex    │
   │                     │   - Tools    │
   │                     └──────────────┘
   │                            │
   │                            │ runs process
   │                            │ outputs to stdout
   │                            ▼
   └────────────────────  Posts to Jira
```

## Quick Start

### 1. Create Your Docker Image

**Option A: Use the example Dockerfile**

Copy `docs/Dockerfile.example` to your repo:

```bash
mkdir -p .github/docker
cp docs/Dockerfile.example .github/docker/Dockerfile
cp docs/docker-entrypoint.sh .github/docker/
```

**Option B: Create a custom Dockerfile**

```dockerfile
FROM node:22-bullseye

# Install your dependencies
RUN apt-get update && apt-get install -y git curl jq

# Install Claude/Codex/tools
# Add your installation commands here

WORKDIR /workspace
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

### 2. Build and Publish Your Image

**Option 1: Publish to Docker Hub**

```bash
# Build
docker build -t your-username/jira-processor:latest -f .github/docker/Dockerfile .

# Test locally
docker run --rm -e JIRA_ISSUE_KEY=TEST-123 your-username/jira-processor:latest

# Login and push
docker login
docker push your-username/jira-processor:latest
```

**Option 2: Publish to GitHub Container Registry (ghcr.io)**

```bash
# Build
docker build -t ghcr.io/your-org/jira-processor:latest -f .github/docker/Dockerfile .

# Login (use PAT with write:packages scope)
echo $GITHUB_TOKEN | docker login ghcr.io -u your-username --password-stdin

# Push
docker push ghcr.io/your-org/jira-processor:latest
```

**Option 3: Build in GitHub Actions (recommended for iteration)**

See "Building Images in CI" section below.

### 3. Update GitHub Actions Workflow

The workflow at `.github/workflows/jira-docker-webhook.yml` is ready to use. Just update the image name:

```yaml
- name: Pull Docker image
  run: |
    docker pull your-username/jira-processor:latest
    # Or for GHCR:
    # docker pull ghcr.io/${{ github.repository_owner }}/jira-processor:latest

- name: Run Docker container
  run: |
    docker run --rm \
      -v "${{ github.workspace }}:/workspace" \
      -w /workspace \
      -e JIRA_ISSUE_KEY="${{ github.event.client_payload.issue.key }}" \
      your-username/jira-processor:latest \
      2>&1 | tee docker_output.txt
```

### 4. Configure Jira Webhook

Same as the standard setup - point your Jira webhook to:

```
https://api.github.com/repos/OWNER/REPO/dispatches
```

With `event_type: jira_issue_created`

## How It Works

### Data Flow

1. **Jira webhook** sends issue data to GitHub Actions
2. **GitHub Actions** receives the webhook and:
   - Checks out your repository
   - Pulls your Docker image
   - Runs the container with:
     - Repository mounted at `/workspace`
     - Jira data as environment variables
     - Captures stdout/stderr
3. **Docker container** runs your entrypoint script:
   - Reads environment variables
   - Accesses the repo at `/workspace`
   - Runs Claude/Codex/custom tools
   - Outputs results to stdout
   - Optionally posts to Jira directly
4. **GitHub Actions** captures the output and posts to Jira

### Environment Variables Passed to Container

The workflow automatically passes these to your container:

```bash
JIRA_ISSUE_KEY          # e.g., "PROJ-123"
JIRA_ISSUE_SUMMARY      # Issue title
JIRA_ISSUE_DESCRIPTION  # Issue body
JIRA_BASE_URL          # e.g., "https://company.atlassian.net"
JIRA_USER_EMAIL        # For API auth
JIRA_API_TOKEN         # For API auth
```

Access them in your entrypoint script:

```bash
echo "Processing issue: ${JIRA_ISSUE_KEY}"
echo "Summary: ${JIRA_ISSUE_SUMMARY}"
```

## Example: Installing Claude Code

If Claude Code becomes available as a package, your Dockerfile might look like:

```dockerfile
FROM node:22-bullseye

# Install Claude Code
RUN npm install -g @anthropic/claude-code

# Or download from GitHub releases
RUN curl -L https://github.com/anthropics/claude-code/releases/latest/download/claude-code-linux-x64 \
    -o /usr/local/bin/claude-code && \
    chmod +x /usr/local/bin/claude-code

WORKDIR /workspace
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Then in your entrypoint:

```bash
#!/bin/bash
set -e

echo "Running Claude Code on issue ${JIRA_ISSUE_KEY}"

# Run Claude Code with the issue description
claude-code analyze --context "${JIRA_ISSUE_DESCRIPTION}"

# Or run a specific command
claude-code run "Fix the issue described in: ${JIRA_ISSUE_SUMMARY}"
```

## Example: Using OpenAI Codex

```dockerfile
FROM python:3.11-slim

# Install dependencies
RUN apt-get update && apt-get install -y git curl jq && \
    rm -rf /var/lib/apt/lists/*

# Install OpenAI package
RUN pip install openai

WORKDIR /workspace
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Entrypoint script:

```bash
#!/bin/bash
set -e

# Require OPENAI_API_KEY to be passed from GitHub Actions
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY not set"
    exit 1
fi

# Call OpenAI API
python3 << EOF
import os
import openai

openai.api_key = os.environ["OPENAI_API_KEY"]

response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a code assistant analyzing Jira issues."},
        {"role": "user", "content": f"Analyze: {os.environ['JIRA_ISSUE_SUMMARY']}"}
    ]
)

print(response.choices[0].message.content)
EOF
```

Don't forget to add `OPENAI_API_KEY` to GitHub Secrets and pass it to the container:

```yaml
- name: Run Docker container
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    docker run --rm \
      -v "${{ github.workspace }}:/workspace" \
      -e OPENAI_API_KEY="${OPENAI_API_KEY}" \
      your-username/codex-processor:latest
```

## Building Images in CI

For faster iteration, build your Docker image in GitHub Actions:

```yaml
jobs:
  run-docker-process:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build Docker image
        run: |
          docker build -t jira-processor:latest -f .github/docker/Dockerfile .

      - name: Run Docker container
        run: |
          docker run --rm \
            -v "${{ github.workspace }}:/workspace" \
            -e JIRA_ISSUE_KEY="${{ github.event.client_payload.issue.key }}" \
            jira-processor:latest \
            2>&1 | tee docker_output.txt
```

This is useful during development. For production, pre-build and publish to a registry.

## Advanced: Multi-Stage Builds

Optimize image size with multi-stage builds:

```dockerfile
# Build stage
FROM node:22-bullseye AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Runtime stage
FROM node:22-slim

# Install only runtime dependencies
RUN apt-get update && apt-get install -y git curl && \
    rm -rf /var/lib/apt/lists/*

# Copy from builder
COPY --from=builder /app/node_modules /app/node_modules

WORKDIR /workspace
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

## Security Best Practices

### 1. Use Specific Image Tags

```bash
# Bad: uses 'latest' which can change
docker pull your-username/processor:latest

# Good: pin to a specific version
docker pull your-username/processor:v1.2.3
```

### 2. Scan Images for Vulnerabilities

```bash
# Use Docker Scout or Trivy
docker scout cves your-username/processor:latest
trivy image your-username/processor:latest
```

### 3. Don't Commit Secrets to Images

```dockerfile
# Bad: hardcoded secrets
ENV JIRA_API_TOKEN=secret123

# Good: pass via environment variables at runtime
# (secrets are passed from GitHub Actions)
```

### 4. Use Non-Root User

```dockerfile
FROM node:22-bullseye

# Create non-root user
RUN useradd -m -u 1001 processor
USER processor

WORKDIR /workspace
# ... rest of Dockerfile
```

### 5. Keep Images Updated

Regularly rebuild images to get security patches:

```bash
docker build --no-cache -t your-username/processor:latest .
```

## Troubleshooting

### Container exits immediately

**Symptom:** Container runs and exits without output

**Solutions:**

1. Check entrypoint script has correct shebang: `#!/bin/bash`
2. Ensure script is executable: `chmod +x docker-entrypoint.sh`
3. Add debugging: `set -x` at top of script
4. Test locally: `docker run --rm -it your-image:latest /bin/bash`

### Permission denied errors

**Symptom:** Can't write to `/workspace`

**Solutions:**

1. Check volume mount: `-v "${{ github.workspace }}:/workspace"`
2. Run as correct user: add `--user $(id -u):$(id -g)`
3. Or change ownership in Dockerfile

### Environment variables not available

**Symptom:** Script can't read `$JIRA_ISSUE_KEY`

**Solutions:**

1. Check `-e` flags in docker run command
2. Verify secrets are set in GitHub
3. Test locally: `docker run -e JIRA_ISSUE_KEY=TEST-123 ...`

### Image pull failures

**Symptom:** `Error: pull access denied`

**Solutions:**

1. **Public image:** Check image name and tag exist
2. **Private image:** Add docker login step:
   ```yaml
   - name: Login to Docker Hub
     run: echo "${{ secrets.DOCKER_PASSWORD }}" | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
   ```
3. **GHCR:** Use `GITHUB_TOKEN`:
   ```yaml
   - name: Login to GHCR
     run: echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
   ```

### Output not captured

**Symptom:** Jira comment is empty

**Solutions:**

1. Ensure script writes to stdout: `echo "results"`
2. Check stderr is captured: `2>&1 | tee output.txt`
3. Verify file exists: `cat docker_output.txt`

## Cost Considerations

### Image Storage

- **Docker Hub:** 1 private repo free, then $7/month
- **GitHub Packages:** 500MB free for private repos
- **Alternatives:** AWS ECR, Google GCR, Azure ACR

### Build Time

- Building in CI adds 1-5 minutes per run
- Pre-building and using a registry is faster
- Use caching to speed up builds

### GitHub Actions Minutes

- Docker operations count toward minutes
- Build: ~1-5 minutes
- Pull + run: ~30 seconds
- Consider pre-building for high-volume workflows

## Examples

### Example 1: Run Tests in Docker

```bash
#!/bin/bash
# docker-entrypoint.sh

set -e

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Running tests..."
pnpm test 2>&1

echo "Tests completed!"
```

### Example 2: Lint Code

```bash
#!/bin/bash

echo "Running linter..."
pnpm run lint || {
    echo "Linting failed!"
    exit 1
}

echo "Linting passed!"
```

### Example 3: Generate Documentation

```bash
#!/bin/bash

echo "Generating docs for ${JIRA_ISSUE_KEY}..."

# Generate docs
pnpm run docs:generate

# If docs changed, post to Jira
if [ -n "$(git status --porcelain docs/)" ]; then
    echo "Documentation updated!"
    # Upload docs or post summary
fi
```

## Next Steps

1. **Create your Dockerfile:** Start with `docs/Dockerfile.example`
2. **Write your entrypoint:** Customize `docs/docker-entrypoint.sh`
3. **Build locally:** Test your image before publishing
4. **Publish to registry:** Docker Hub or GHCR
5. **Update workflow:** Point to your image
6. **Test end-to-end:** Create a Jira issue and verify

## Resources

- [Docker documentation](https://docs.docker.com/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Hub](https://hub.docker.com/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker security best practices](https://docs.docker.com/develop/security-best-practices/)
