# Jira Integration Overview

This document provides a high-level overview of the Jira webhook integrations available in this repository.

## Available Integration Patterns

### 1. Docker Container Integration

**Flow:** Jira → GitHub Actions → Docker Container → Jira

**Files:**

- `.github/workflows/jira-docker-webhook.yml`
- `docs/Dockerfile.example`
- `docs/docker-entrypoint.sh`

**Best for:**

- Consistent environment across runs
- Pre-installed tools (Claude, Codex, custom dependencies)
- Complex setup or dependencies
- Reproducible builds
- Sharing environments across projects

**Setup time:** ~30 minutes (including Docker image build)

**Pros:**

- **Consistent:** Same environment every time
- **Isolated:** Doesn't affect GitHub Actions runner
- **Reusable:** Same image for multiple workflows
- **Version controlled:** Environment as code
- **Local testing:** Run the same image locally

**Cons:**

- Requires Docker image build and hosting
- Slightly slower (image pull overhead)
- More initial setup complexity
- Need Docker registry (Docker Hub, GHCR, etc.)

---

### 2. Direct GitHub Actions Integration

**Flow:** Jira → GitHub Actions → Jira

**Files:**

- `.github/workflows/jira-webhook.yml`

**Best for:**

- Simple, quick processes (< 5 minutes)
- Minimal dependencies
- GitHub-native workflows
- Quick prototyping

**Setup time:** ~10 minutes

**Pros:**

- Simple setup
- No additional services needed
- Fast execution for simple tasks
- Free for public repos

**Cons:**

- 6-hour timeout limit
- Limited to GitHub Actions runners
- Less caching options than CircleCI

---

### 3. CircleCI Integration

**Flow:** Jira → GitHub Actions → CircleCI → Jira

**Files:**

- `.github/workflows/jira-circleci-webhook.yml` (receives webhook, triggers CircleCI)
- `docs/circleci-config-example.yml` (CircleCI configuration template)

**Best for:**

- Complex build environments
- Long-running processes (> 30 minutes)
- Advanced caching needs
- Docker layer caching
- Parallel job execution
- Existing CircleCI infrastructure

**Setup time:** ~20 minutes

**Pros:**

- Longer timeout limits
- Better caching (Docker layers, dependencies)
- Advanced parallelization
- Robust build environment
- SSH debugging

**Cons:**

- Requires CircleCI account and setup
- More complex configuration
- Additional API token management
- Small overhead from GitHub → CircleCI trigger

---

## Quick Start

### For Docker Container

1. Create Dockerfile with your dependencies (Claude, Codex, etc.)
2. Build and push to Docker Hub or GHCR
3. Follow GitHub Actions setup (steps 1-4 below)
4. Update `.github/workflows/jira-docker-webhook.yml` with your image name
5. Test by creating a Jira issue

**Documentation:** [docs/docker-integration-guide.md](./docker-integration-guide.md)

### For GitHub Actions

1. Create GitHub PAT with `repo` scope
2. Configure Jira webhook to `https://api.github.com/repos/OWNER/REPO/dispatches`
3. Create Jira API token
4. Add secrets to GitHub: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`
5. Customize `.github/workflows/jira-webhook.yml` with your process
6. Test by creating a Jira issue

**Documentation:** [docs/jira-webhook-setup.md](./jira-webhook-setup.md)

### For CircleCI

1. Follow steps 1-4 above
2. Create CircleCI API token
3. Add `CIRCLE_TOKEN` to GitHub secrets
4. Copy `docs/circleci-config-example.yml` to `.circleci/config.yml`
5. Customize CircleCI jobs with your process
6. Test by creating a Jira issue

**Documentation:** [docs/jira-webhook-setup.md#alternative-using-circleci-instead-of-github-actions](./jira-webhook-setup.md#alternative-using-circleci-instead-of-github-actions)

---

## Integration Flow Comparison

### Docker Container Flow

```
┌──────┐      webhook      ┌────────────────┐
│ Jira │ ─────────────────>│ GitHub Actions │
└──────┘                   └────────────────┘
   ^                              │
   │                              │ pulls image
   │                              ▼
   │                       ┌──────────────┐
   │                       │ Docker Image │
   │                       │  (ghcr.io/)  │
   │                       └──────────────┘
   │                              │
   │                              │ runs container
   │                              │ mounts repo
   │                              │ passes env vars
   │                              ▼
   │                       ┌────────────┐
   │                       │ Container  │
   │                       │ - Claude   │
   │                       │ - Codex    │
   │                       │ - Tools    │
   │                       └────────────┘
   │                              │
   │                              │ outputs results
   │                              ▼
   │                       ┌────────────┐
   └───────────────────────│  Post to   │
         API call          │    Jira    │
                           └────────────┘
```

**Timeline:**

- 0s: Jira issue created
- <1s: GitHub Actions triggered
- 1-3s: Docker image pulled (or cached)
- 0-30min: Container runs process
- ~1s: Results posted to Jira

---

### GitHub Actions Flow

```
┌──────┐      webhook      ┌────────────────┐
│ Jira │ ─────────────────>│ GitHub Actions │
└──────┘                   └────────────────┘
   ^                              │
   │                              │ runs process
   │                              │ captures output
   │                              ▼
   │                       ┌────────────┐
   └───────────────────────│  Post to   │
         API call          │    Jira    │
                           └────────────┘
```

**Timeline:**

- 0s: Jira issue created
- <1s: GitHub Actions triggered
- 0-5min: Process runs
- ~1s: Results posted to Jira

---

### CircleCI Flow

```
┌──────┐      webhook      ┌────────────────┐
│ Jira │ ─────────────────>│ GitHub Actions │
└──────┘                   └────────────────┘
   ^                              │
   │                              │ triggers
   │                              ▼
   │                       ┌────────────┐
   │                       │  CircleCI  │
   │                       │  Pipeline  │
   │                       └────────────┘
   │                              │
   │                              │ runs process
   │                              │ captures output
   │                              ▼
   │                       ┌────────────┐
   └───────────────────────│  Post to   │
         API calls         │    Jira    │
                           └────────────┘
```

**Timeline:**

- 0s: Jira issue created
- <1s: GitHub Actions triggered
- 1-2s: "Processing started" posted to Jira
- 1-3s: CircleCI pipeline triggered
- 5-10s: "Build started" posted from CircleCI
- 0-30+min: Process runs in CircleCI
- ~1s: Results posted to Jira
- ~1s: "Build completed" posted to Jira

---

## Jira Updates During Execution

### Docker Container Pattern

Jira receives:

1. **Acknowledgment** - "Docker processing started"
2. **Process output** - Full stdout/stderr from your container
3. **Workflow link** - Link back to GitHub Actions run

The container can also post updates to Jira directly during execution if desired.

### GitHub Actions Pattern

Jira receives:

1. **Process output** - Full stdout/stderr from your command
2. **Workflow link** - Link back to GitHub Actions run

### CircleCI Pattern

Jira receives:

1. **Acknowledgment** (from GitHub Actions) - "Processing started"
2. **Build started** (from CircleCI) - With build URL
3. **Process output** (from CircleCI) - Full stdout/stderr
4. **Build completed** (from CircleCI) - Success/failure status with build URL

---

## Security Considerations

Both patterns use:

- **HTTPS-only** communication
- **GitHub Secrets** for all credentials
- **Bearer tokens** in Authorization headers
- **Jira API tokens** (not passwords)

### Credentials Required

**GitHub Actions:**

- GitHub PAT (webhook trigger)
- Jira API token (posting comments)

**CircleCI:**

- GitHub PAT (webhook trigger)
- Jira API token (posting comments)
- CircleCI API token (triggering pipelines)

---

## Which Pattern Should You Use?

### Use Docker Container When:

- ✅ Need Claude, Codex, or complex dependencies pre-installed
- ✅ Want consistent environment across all runs
- ✅ Testing locally is important (same image everywhere)
- ✅ Multiple workflows need the same environment
- ✅ Dependencies take >2 minutes to install
- ✅ Want to version control your execution environment

### Use GitHub Actions When:

- ✅ Simple processes with minimal dependencies
- ✅ Quick iteration and testing
- ✅ Don't want to manage Docker images
- ✅ Process completes in <5 minutes
- ✅ Using only npm/pnpm packages

### Use CircleCI When:

- ✅ All Docker benefits PLUS:
- ✅ Need longer timeouts (>30 minutes)
- ✅ Advanced caching (Docker layers, dependencies)
- ✅ Parallel job execution
- ✅ SSH debugging into failed builds
- ✅ Existing CircleCI infrastructure

### Decision Tree

```
Start
  │
  ├─ Need Claude/Codex pre-installed? ─── Yes ──> Docker Container
  │                                                     │
  │                                              Need >30min? ─── Yes ──> CircleCI + Docker
  │                                                     │
  │                                                    No ──> Docker + GitHub Actions
  │
  └─ Simple npm/pnpm packages only?
         │
         ├─ Need >30min? ─── Yes ──> CircleCI
         │
         └─ No ──> GitHub Actions
```

---

## Customization Examples

### GitHub Actions: Run Tests

```yaml
- name: Run tests
  run: |
    pnpm install
    pnpm test 2>&1 | tee /tmp/results.txt
```

### CircleCI: Run Tests with Caching

```yaml
- restore_cache:
    keys:
      - deps-{{ checksum "pnpm-lock.yaml" }}
- run: pnpm install
- save_cache:
    key: deps-{{ checksum "pnpm-lock.yaml" }}
    paths:
      - node_modules
- run: pnpm test 2>&1 | tee /tmp/results.txt
```

---

## Cost Comparison

### GitHub Actions

- **Free tier:** 2,000 minutes/month for private repos
- **Public repos:** Unlimited
- **Paid:** $0.008/minute after free tier

### CircleCI

- **Free tier:** 6,000 build minutes/month (Performance plan)
- **Paid:** Varies by plan
- **Docker layer caching:** Paid feature

For typical use cases with a few Jira triggers per day, both stay within free tiers.

---

## Troubleshooting Quick Reference

| Issue                      | GitHub Actions                          | CircleCI                                 |
| -------------------------- | --------------------------------------- | ---------------------------------------- |
| Webhook not firing         | Check PAT, verify URL                   | Same                                     |
| Process not running        | Check workflow file on main branch      | Check CircleCI project is following repo |
| Jira not receiving updates | Verify Jira secrets, check API response | Check pipeline parameters being passed   |
| Long-running timeout       | Consider CircleCI                       | Increase CircleCI resource class         |

---

## Next Steps

1. **Read full documentation:** [jira-webhook-setup.md](./jira-webhook-setup.md)
2. **Choose your pattern:** GitHub Actions (simple) or CircleCI (complex)
3. **Set up credentials:** GitHub PAT, Jira API token, (CircleCI token)
4. **Customize workflow:** Add your actual process commands
5. **Test:** Create a test Jira issue and verify the flow

---

## Support & Resources

### Documentation

- **Full setup guide:** [docs/jira-webhook-setup.md](./jira-webhook-setup.md)
- **Docker integration guide:** [docs/docker-integration-guide.md](./docker-integration-guide.md)
- **CircleCI config example:** [docs/circleci-config-example.yml](./circleci-config-example.yml)

### Workflow Files

- **Docker workflow:** [.github/workflows/jira-docker-webhook.yml](../.github/workflows/jira-docker-webhook.yml)
- **GitHub Actions workflow:** [.github/workflows/jira-webhook.yml](../.github/workflows/jira-webhook.yml)
- **CircleCI workflow:** [.github/workflows/jira-circleci-webhook.yml](../.github/workflows/jira-circleci-webhook.yml)

### Example Files

- **Dockerfile:** [docs/Dockerfile.example](./Dockerfile.example)
- **Docker entrypoint:** [docs/docker-entrypoint.sh](./docker-entrypoint.sh)
