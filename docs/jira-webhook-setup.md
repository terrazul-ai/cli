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

## Step 4: Customize the Workflow

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

## Security Best Practices

1. **Store PAT securely:**
   - Use Jira's webhook configuration (it's encrypted)
   - Never commit tokens to the repository
   - Rotate tokens regularly

2. **Validate webhook payload:**
   - The workflow should validate that payloads are from Jira
   - Consider using webhook secrets if available

3. **Limit permissions:**
   - Use a PAT with minimal required scopes
   - Consider using a GitHub App instead of a PAT for better security

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

- [GitHub Actions: repository_dispatch event](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch)
- [Jira Webhooks Documentation](https://developer.atlassian.com/server/jira/platform/webhooks/)
- [GitHub REST API: Create a repository dispatch event](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
