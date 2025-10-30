#!/bin/bash
# Docker entrypoint script for processing Jira issues
# This script runs inside the Docker container

set -e

echo "=================================="
echo "Docker Container Started"
echo "=================================="
echo "Jira Issue: ${JIRA_ISSUE_KEY}"
echo "Summary: ${JIRA_ISSUE_SUMMARY}"
echo "=================================="

# The repository is already mounted at /workspace by GitHub Actions
# So we don't need to clone it

# Check if we're in a git repository
if [ -d ".git" ]; then
    echo "✓ Repository detected at /workspace"
    echo "Current branch: $(git branch --show-current)"
else
    echo "⚠ No git repository found at /workspace"
fi

# Example 1: Run Claude Code (if installed)
# Uncomment and customize based on your needs
run_claude_code() {
    echo ""
    echo "Running Claude Code analysis..."

    # Example: Ask Claude to analyze the Jira issue
    # claude-code ask "Analyze this Jira issue: ${JIRA_ISSUE_SUMMARY}" \
    #     --context "${JIRA_ISSUE_DESCRIPTION}"

    # Example: Run Claude Code with a specific prompt
    # claude-code analyze --issue "${JIRA_ISSUE_KEY}"

    echo "Claude Code analysis completed"
}

# Example 2: Run OpenAI Codex (if installed)
run_codex() {
    echo ""
    echo "Running Codex analysis..."

    # Example: Call OpenAI API
    # python3 << EOF
    # import os
    # import openai
    #
    # openai.api_key = os.environ.get("OPENAI_API_KEY")
    #
    # response = openai.ChatCompletion.create(
    #     model="gpt-4",
    #     messages=[
    #         {"role": "system", "content": "You are a code assistant."},
    #         {"role": "user", "content": f"Analyze this Jira issue: {os.environ['JIRA_ISSUE_SUMMARY']}"}
    #     ]
    # )
    #
    # print(response.choices[0].message.content)
    # EOF

    echo "Codex analysis completed"
}

# Example 3: Run custom script from the repo
run_custom_script() {
    echo ""
    echo "Running custom script..."

    # Check if a custom script exists in the repo
    if [ -f "scripts/process-jira-issue.js" ]; then
        node scripts/process-jira-issue.js \
            --issue-key "${JIRA_ISSUE_KEY}" \
            --summary "${JIRA_ISSUE_SUMMARY}"
    else
        echo "No custom script found at scripts/process-jira-issue.js"
    fi
}

# Example 4: Post updates to Jira from within the container
post_to_jira() {
    local message="$1"

    echo ""
    echo "Posting to Jira: ${message}"

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
            "text": "${message}"
          }
        ]
      }
    ]
  }
}
EOF
)

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}" \
        -d "$comment_body" \
        "${JIRA_BASE_URL}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment" > /dev/null

    echo "Posted to Jira successfully"
}

# Main execution flow
main() {
    # Post start message to Jira
    post_to_jira "🔄 Docker container processing started..."

    # Run your processing steps here
    # Uncomment the functions you want to use:

    # run_claude_code
    # run_codex
    # run_custom_script

    # Example: Run tests
    if [ -f "package.json" ]; then
        echo ""
        echo "Running tests..."
        pnpm install --frozen-lockfile
        pnpm test || true
    fi

    # Example: Generate a report
    echo ""
    echo "=== Processing Results ==="
    echo "Issue processed: ${JIRA_ISSUE_KEY}"
    echo "Status: Completed"
    echo "Timestamp: $(date)"
    echo "=========================="

    # Post completion message to Jira
    post_to_jira "✅ Docker container processing completed"
}

# Run main function
main

# Exit successfully
exit 0
