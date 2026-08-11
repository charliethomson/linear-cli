# Prompt: Create Linear Issues from Codebase Analysis

You are tasked with analyzing the current codebase and creating structured Linear issues for identified problems, improvements, and technical debt.

## Step 1: Analyze the Codebase

Systematically examine the codebase for the following categories:

### Security Issues (Priority 1 - Urgent)
- Hardcoded credentials, API keys, or secrets
- SQL injection vulnerabilities (string concatenation in queries)
- XSS vulnerabilities (unsanitized user input in HTML)
- Insecure direct object references
- Missing authentication/authorization checks
- Outdated dependencies with known CVEs

### High Priority Issues (Priority 2 - High)
- `FIXME:` and `HACK:` comments
- Error handling that swallows exceptions silently
- Race conditions or concurrency bugs
- Memory leaks (unclosed resources, circular references)
- Missing input validation at API boundaries
- Broken tests or tests that are skipped

### Medium Priority Issues (Priority 3 - Medium)
- `TODO:` comments with significant scope
- Missing tests for critical code paths
- Performance bottlenecks (N+1 queries, missing indexes, unoptimized loops)
- Deprecated API usage
- Inconsistent error handling patterns
- Documentation gaps for public APIs

### Low Priority Issues (Priority 4 - Low)
- Code style inconsistencies
- Minor `TODO:` comments
- Unused code and dead code paths
- Refactoring opportunities (large functions, deep nesting, duplication)
- Missing type annotations in dynamic code

## Step 2: Gather Linear Context

```bash
# Get teams
linear teams list

# Get workflow states for the target team
linear states list --team <team-id>

# Get available labels
linear labels list --team <team-id>

# Get team members (for potential assignment)
linear users list --team <team-id>
```

Identify:
- The `backlog` or `triage` state ID for new issues
- Relevant label IDs (look for: `bug`, `security`, `tech-debt`, `enhancement`, `documentation`)
- Target team ID

## Step 3: Create Issues

Build the complete list of issues as a JSON array, write it to `/tmp/linear-issues.json`, then create all issues in one command:

```bash
# 1. Write all issues to a JSON file
cat > /tmp/linear-issues.json << 'EOF'
[
  {
    "team": "<team-id>",
    "title": "<clear, actionable title>",
    "description": "## Problem\n\n<description>\n\n## Location\n\n- File: `src/path/to/file.ts`\n- Line: ~42\n\n## Impact\n\n<why this matters>\n\n## Suggested Fix\n\n<approach>",
    "priority": 1,
    "state": "<backlog-state-id>",
    "labels": ["<label-id>"]
  },
  {
    "team": "<team-id>",
    "title": "<another title>",
    "priority": 2,
    "state": "<backlog-state-id>"
  }
]
EOF

# 2. Create all issues in one command
linear issues bulk-create --file /tmp/linear-issues.json
```

Parse `created[].identifier` from the output to get issue identifiers for the summary.

> **Note**: Use `bulk-create` for all batches of issues. Only fall back to `linear issues create` for a single issue that requires a description too long for inline JSON (write it to a separate file first).

## Issue Title Guidelines

Good issue titles are:
- Actionable: Start with a verb ("Fix", "Add", "Refactor", "Remove", "Update")
- Specific: Include what and where ("Fix SQL injection in user search endpoint")
- Not vague: Avoid "Improve performance" — use "Add database index to users.email column"

## Priority Assignment Guide

| Priority | Code | When to use |
|----------|------|-------------|
| Urgent | 1 | Security vulnerabilities, data loss risks, production outages |
| High | 2 | Bugs causing incorrect behavior, broken tests, FIXME/HACK comments |
| Medium | 3 | Missing tests, performance issues, TODO items with real impact |
| Low | 4 | Style issues, minor refactors, cosmetic improvements |

## Step 4: Link Related Issues

After creating all issues, add cross-references for related ones by updating descriptions or adding comments:

```bash
linear issues comment <issue-id> --body "Related to <ENG-123> — both stem from the missing input validation layer"
```

## Step 5: Report Summary

Provide a structured summary:

```
## Issues Created

### Urgent (Priority 1)
- ENG-XXX: Fix hardcoded AWS credentials in config.ts

### High Priority (Priority 2)
- ENG-XXX: Fix silent error swallowing in payment processor
- ENG-XXX: Add missing authentication check to admin API

### Medium Priority (Priority 3)
- ENG-XXX: Add tests for user registration flow
- ENG-XXX: Fix N+1 query in project list endpoint

### Low Priority (Priority 4)
- ENG-XXX: Refactor 300-line processOrder function
```

Include total count by priority and any patterns observed (e.g., "The auth module has a cluster of related issues that should be addressed together").

## Notes

- **Don't create duplicate issues**: Before creating, search for existing ones with `linear issues list --team <id> --search "<keyword>"`
- **Batch similar issues**: If there are 10 similar style issues, create one tracking issue rather than 10 individual ones
- **Be selective**: Aim for quality over quantity — 10 well-scoped, actionable issues are better than 50 vague ones
- **Respect project context**: If a `--project <id>` is specified, link all issues to that project
