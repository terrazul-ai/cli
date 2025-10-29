# Jira to GitHub Actions Webhook Setup

This guide explains how to configure a Jira webhook to trigger GitHub Actions in this repository.

## Overview

When a Jira issue is created, a webhook will send the issue data to GitHub, triggering the `jira-webhook.yml` workflow via the `repository_dispatch` event.

## Prerequisites

- Jira admin access (to create webhooks)
- GitHub repository admin access
- GitHub Personal Access Token with `repo` scope

## Step 1: Create a GitHub Personal Access Token (PAT)

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Name it (e.g., "Jira Webhook Integration")
4. Select scopes:
   - `repo` (Full control of private repositories)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again)

## Step 2: Configure Jira Webhook

### Using Jira Cloud

1. Go to **Jira Settings** → **System** → **WebHooks**
2. Click **Create a WebHook**
3. Fill in the details:

   **Name:** `GitHub Actions - Issue Created`

   **Status:** `Enabled`

   **URL:**

   ```
   https://api.github.com/repos/OWNER/REPO/dispatches
   ```

   Replace `OWNER` with your GitHub username/org and `REPO` with repository name.
   For this repo:

   ```
   https://api.github.com/repos/YOUR_ORG/cli/dispatches
   ```

   **Description:** (optional)

   ```
   Triggers GitHub Actions when Jira issues are created
   ```

   **Events:** Select `Issue → created`

4. Click **Advanced** and add custom headers:

   ```
   Authorization: Bearer YOUR_GITHUB_PAT
   Content-Type: application/json
   ```

5. In the **Body** section, select "Custom data" and use this JQL template:

   ```json
   {
     "event_type": "jira_issue_created",
     "client_payload": {
       "issue": {
         "key": "${issue.key}",
         "id": "${issue.id}",
         "self": "${issue.self}",
         "fields": {
           "summary": "${issue.summary}",
           "description": "${issue.description}",
           "issuetype": {
             "name": "${issue.issueType}"
           },
           "reporter": {
             "displayName": "${issue.reporter.displayName}",
             "emailAddress": "${issue.reporter.emailAddress}"
           },
           "priority": {
             "name": "${issue.priority}"
           },
           "status": {
             "name": "${issue.status}"
           },
           "created": "${issue.created}",
           "updated": "${issue.updated}"
         }
       },
       "webhook_event": "${webhookEvent}",
       "timestamp": "${timestamp}"
     }
   }
   ```

6. Click **Create**

## Step 3: Test the Integration

### Manual Test from Jira

1. Create a test Jira issue in your project
2. Check the webhook execution:
   - In Jira: **Settings** → **System** → **WebHooks** → Click your webhook → View recent deliveries
3. Check GitHub Actions:
   - Go to your repository → **Actions** tab
   - Look for a workflow run named "Jira Webhook Handler"

### Manual Test via API (for debugging)

You can manually trigger the workflow using curl:

```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: Bearer YOUR_GITHUB_PAT" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{
    "event_type": "jira_issue_created",
    "client_payload": {
      "issue": {
        "key": "TEST-123",
        "fields": {
          "summary": "Test issue",
          "description": "This is a test",
          "issuetype": {
            "name": "Task"
          },
          "reporter": {
            "displayName": "Test User"
          }
        }
      }
    }
  }'
```

## Step 4: Set Up Jira API Credentials (For Posting Back to Jira)

To post GitHub Action results back to Jira as comments, you need to configure Jira API credentials.

### Create a Jira API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g., "GitHub Actions Integration")
4. Click **Create**
5. **Copy the token immediately** (you won't see it again)

### Add Secrets to GitHub Repository

1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add these three secrets:

   **JIRA_BASE_URL**

   ```
   https://your-company.atlassian.net
   ```

   (Your Jira instance URL, without trailing slash)

   **JIRA_USER_EMAIL**

   ```
   your-email@company.com
   ```

   (The email address associated with your Jira account)

   **JIRA_API_TOKEN**

   ```
   ATATT3xFfGF0...
   ```

   (The API token you created above)

### How It Works

The workflow now includes steps that:

1. **Capture process output:**
   - Runs your custom process/script
   - Captures stdout/stderr to a file
   - Makes it available for the next step

2. **Post back to Jira:**
   - Reads the captured output
   - Formats it as a Jira comment (using Jira Document Format)
   - Posts the comment to the original Jira issue using the REST API
   - Includes a link back to the GitHub Actions run

3. **Optional status update:**
   - Can transition the Jira issue to a different status
   - Lists available transitions for debugging

### Customize Your Process

Edit the workflow file to run your actual process. Replace this section:

```yaml
- name: Run your process and capture output
  id: process_output
  run: |
    # Your process command - replace with actual command
    output=$(your-command --arg1 --arg2)

    # Store output in a file to preserve multiline content
    echo "$output" > process_output.txt
```

**Examples:**

```yaml
# Example 1: Run tests and capture results
output=$(pnpm test 2>&1 || true)

# Example 2: Run a build and capture logs
output=$(pnpm run build 2>&1)

# Example 3: Run a custom script
output=$(node scripts/analyze-issue.js "${{ github.event.client_payload.issue.key }}" 2>&1)

# Example 4: Call an API and format results
output=$(curl -s https://api.example.com/analyze | jq -r '.result')
```

### Comment Format

The default format posts output as a code block. You can customize the comment format by editing the `comment_body` in the workflow. The Jira Document Format supports:

- **Text formatting:** bold, italic, code
- **Lists:** bullet and numbered
- **Links:** inline and reference
- **Code blocks:** with syntax highlighting
- **Tables, panels, and more**

**Simple plain text comment:**

```bash
comment_body=$(cat <<EOF
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "$output"
          }
        ]
      }
    ]
  }
}
EOF
)
```

See [Jira Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) for more options.

## Step 5: Customize the Workflow

The workflow file is located at `.github/workflows/jira-webhook.yml`. You can customize it to:

- **Send Slack notifications:**

  ```yaml
  - name: Notify Slack
    uses: slackapi/slack-github-action@v1.24.0
    with:
      webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
      payload: |
        {
          "text": "New Jira issue: ${{ github.event.client_payload.issue.key }}"
        }
  ```

- **Trigger builds:**

  ```yaml
  - name: Setup Node.js
    uses: actions/setup-node@v4
    with:
      node-version: '22'

  - name: Install dependencies
    run: pnpm install

  - name: Run build
    run: pnpm run build
  ```

- **Run tests for specific components:**
  ```yaml
  - name: Run related tests
    run: |
      # Extract component from issue labels or description
      pnpm test tests/integration/
  ```

## Troubleshooting

### Webhook not firing

1. Check webhook delivery history in Jira
2. Verify the URL is correct
3. Ensure the GitHub PAT has `repo` scope
4. Check that the PAT hasn't expired

### Workflow not triggering

1. Verify the `event_type` matches exactly: `jira_issue_created`
2. Check GitHub Actions tab for any errors
3. Ensure the workflow file is on the default branch (usually `main`)

### Authentication errors

- **401 Unauthorized:** PAT is invalid or expired
- **403 Forbidden:** PAT doesn't have sufficient permissions
- **404 Not Found:** Repository URL is incorrect

### Jira comment posting errors

1. **401 Unauthorized when posting to Jira:**
   - Verify `JIRA_USER_EMAIL` and `JIRA_API_TOKEN` secrets are set correctly
   - Check that the API token hasn't expired
   - Ensure the email matches the account that created the token

2. **403 Forbidden when posting to Jira:**
   - Verify the user has permission to comment on the issue
   - Check project permissions in Jira

3. **Comment not appearing in Jira:**
   - Check GitHub Actions logs for curl response
   - Verify `JIRA_BASE_URL` doesn't have a trailing slash
   - Ensure JSON payload is valid (check for special characters in output)

4. **Multiline output not formatted correctly:**
   - The workflow stores output to a file to preserve formatting
   - Check that special characters are properly escaped in JSON
   - Consider using `jq` to safely format JSON payloads

## Security Best Practices

1. **Store tokens securely:**
   - Use GitHub Secrets for all credentials (PAT, Jira API token)
   - Use Jira's webhook configuration for the GitHub PAT (it's encrypted)
   - Never commit tokens to the repository
   - Rotate tokens regularly (every 90 days recommended)

2. **Validate webhook payload:**
   - The workflow should validate that payloads are from Jira
   - Consider using webhook secrets if available
   - Add IP allowlisting if your network supports it

3. **Limit permissions:**
   - Use a PAT with minimal required scopes (just `repo`)
   - Create a dedicated Jira service account for API access
   - Grant only necessary permissions in Jira (comment, transition)
   - Consider using a GitHub App instead of a PAT for better security

4. **Secure API communication:**
   - All communication uses HTTPS
   - Jira API tokens are passed via Authorization headers (not URL params)
   - Sensitive data in logs is masked by GitHub Actions

## Alternative: Using CircleCI Instead of GitHub Actions

If you prefer to run your processes in CircleCI, you can use the Jira → GitHub Actions → CircleCI → Jira flow.

### Why Use CircleCI?

- More complex build environments or dependencies
- Longer-running processes (CircleCI has higher time limits)
- Existing CircleCI infrastructure
- Better caching and parallelization for complex workflows

### Setup Overview

1. **Jira webhook** triggers GitHub Actions (as before)
2. **GitHub Actions** receives the webhook and triggers a CircleCI pipeline
3. **CircleCI** runs your process and posts results back to Jira
4. **Jira** receives updates at each stage

### Step 1: Create CircleCI API Token

1. Go to [CircleCI User Settings](https://app.circleci.com/settings/user/tokens)
2. Click **Create New Token**
3. Give it a name (e.g., "Jira Integration")
4. Click **Create Token**
5. **Copy the token immediately**

### Step 2: Add CircleCI Token to GitHub Secrets

Add this to your GitHub repository secrets:

**CIRCLE_TOKEN**

```
your-circleci-token-here
```

### Step 3: Use the CircleCI Workflow

The repository includes a workflow file at `.github/workflows/jira-circleci-webhook.yml` that:

- Receives Jira webhooks
- Posts an acknowledgment to Jira ("Processing started...")
- Triggers a CircleCI pipeline with Jira parameters
- Handles errors and posts them back to Jira

To use it, update your Jira webhook `event_type` to match the workflow:

- `jira_issue_created`
- `jira_issue_updated`

### Step 4: Configure CircleCI

Create or update `.circleci/config.yml` in your repository. A complete example is available at `docs/circleci-config-example.yml`.

**Key features of the CircleCI config:**

1. **Pipeline parameters** - Receives Jira issue data from GitHub Actions:

   ```yaml
   parameters:
     run_jira_workflow:
       type: boolean
       default: false
     jira_issue_key:
       type: string
       default: ''
     jira_base_url:
       type: string
       default: ''
     # ... and more
   ```

2. **Reusable commands** for posting to Jira:

   ```yaml
   commands:
     post_jira_comment:
       description: 'Post a comment to a Jira issue'
       # ... parameters and steps
   ```

3. **Jobs that post updates to Jira:**

   ```yaml
   jobs:
     process-jira-issue:
       steps:
         - post_jira_comment:
             message: 'Build started'
         - run:
             name: Run your process
             command: |
               # Your process here
               echo "Results" | tee /tmp/results.txt
         - post_jira_results:
             results_file: /tmp/results.txt
         - post_jira_comment:
             message: 'Build completed'
             status: 'success'
   ```

4. **Conditional workflow** - Only runs when triggered by Jira:
   ```yaml
   workflows:
     jira-triggered:
       when: << pipeline.parameters.run_jira_workflow >>
       jobs:
         - process-jira-issue
   ```

### Step 5: Test the Integration

1. **Create a test Jira issue**
2. **Check the flow:**
   - GitHub Actions (should trigger CircleCI)
   - CircleCI (should start a pipeline)
   - Jira (should receive multiple comments)

Expected Jira comments:

1. "⚙️ Processing started" (from GitHub Actions)
2. "ℹ️ CircleCI: Build started" (from CircleCI)
3. "📊 Results from CircleCI" (from CircleCI with output)
4. "✅ CircleCI: Build completed successfully" (from CircleCI)

### CircleCI Example: Running Tests

Here's a practical example that runs tests and posts results:

```yaml
jobs:
  run-tests:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - post_jira_comment:
          message: 'Running tests'
      - run:
          name: Install and test
          command: |
            pnpm install
            pnpm test 2>&1 | tee /tmp/test-results.txt
      - post_jira_results:
          results_file: /tmp/test-results.txt
      - post_jira_comment:
          message: 'Tests completed'
          status: 'success'
```

### CircleCI vs GitHub Actions: When to Use Each

**Use GitHub Actions when:**

- Simple, quick processes (< 5 minutes)
- Minimal dependencies
- Staying within GitHub ecosystem
- Using GitHub-specific integrations

**Use CircleCI when:**

- Complex build environments
- Long-running processes (> 30 minutes)
- Need advanced caching
- Existing CircleCI infrastructure
- Need Docker layer caching or parallelization

### Troubleshooting CircleCI Integration

**CircleCI pipeline not triggering:**

1. Check that `CIRCLE_TOKEN` secret is set in GitHub
2. Verify the repository path in the API URL matches your GitHub repo
3. Check CircleCI project is set up and following the repository
4. Look at GitHub Actions logs for the API response

**CircleCI not posting to Jira:**

1. Verify pipeline parameters are being received (check CircleCI UI)
2. Ensure Jira credentials are passed correctly
3. Check CircleCI logs for curl responses
4. Verify the issue key exists and is accessible

**Pipeline parameters not working:**

1. Ensure `.circleci/config.yml` defines the parameters at the top level
2. Check the workflow uses `when: << pipeline.parameters.run_jira_workflow >>`
3. Verify parameter names match exactly between GitHub Actions and CircleCI config

## Additional Events

To handle more Jira events, modify the workflow's `on` section:

```yaml
on:
  repository_dispatch:
    types:
      - jira_issue_created
      - jira_issue_updated
      - jira_issue_deleted
      - jira_status_changed
```

Then create separate webhooks in Jira for each event type with the corresponding `event_type`.

## Resources

### GitHub Actions

- [GitHub Actions: repository_dispatch event](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch)
- [GitHub REST API: Create a repository dispatch event](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [GitHub Actions: Encrypted secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

### Jira API

- [Jira Webhooks Documentation](https://developer.atlassian.com/server/jira/platform/webhooks/)
- [Jira REST API: Add Comment](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-post)
- [Jira Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
- [Jira REST API: Transitions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-transitions-post)

### CircleCI

- [CircleCI API v2 Documentation](https://circleci.com/docs/api/v2/)
- [Trigger a pipeline with parameters](https://circleci.com/docs/api/v2/index.html#operation/triggerPipeline)
- [Pipeline parameters and values](https://circleci.com/docs/pipeline-variables/#pipeline-parameters-in-configuration)
- [Conditional workflows](https://circleci.com/docs/configuration-reference/#using-when-in-workflows)
- [Personal API tokens](https://circleci.com/docs/managing-api-tokens/)
