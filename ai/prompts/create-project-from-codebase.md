# Prompt: Create Linear Project from Codebase Analysis

You are tasked with analyzing the current repository and creating an appropriate Linear project for it.

## Step 1: Analyze the Repository

Examine the following to understand the project:

1. **README.md** — Project name, description, purpose, tech stack
2. **package.json / pyproject.toml / Cargo.toml / go.mod** — Package name, dependencies, scripts
3. **Directory structure** — `src/`, `lib/`, `app/`, `tests/` etc.
4. **Existing documentation** — `docs/`, `CHANGELOG.md`, `CONTRIBUTING.md`
5. **CI/CD config** — `.github/workflows/`, `Makefile`, `Dockerfile`

From this analysis, determine:
- **Project name**: Should be clear and descriptive (e.g., "User Authentication Service", "Data Pipeline v2")
- **Project description**: 1-3 sentences about what this codebase does
- **Project state**: Usually `planned` for new projects, `started` if actively developed
- **Project color**: Pick a relevant hex color (e.g., `#6366f1` for purple, `#10b981` for green)

## Step 2: Discover Linear Context

```bash
# List available teams to pick the right one
linear teams list
```

Review the teams and pick the most appropriate one based on:
- Team name alignment with the codebase purpose
- Team key (e.g., ENG for engineering, DATA for data, etc.)

If unclear, ask the user which team to use before proceeding.

## Step 3: Create the Project

```bash
linear projects create \
  --name "<inferred-name>" \
  --team <selected-team-id> \
  --description "<inferred-description>" \
  --color "<chosen-color>"
```

Note the project ID from the response.

## Step 4: Create Initial Milestone Issues (Optional)

After creating the project, create 3-5 initial issues representing key milestones or workstreams:

First, get the workflow states for the team:
```bash
linear states list --team <team-id>
```

Find the "backlog" or "unstarted" state ID, then create all milestone issues in one command:

```bash
# Build the milestone issues array and create them all at once
cat > /tmp/milestone-issues.json << 'EOF'
[
  {
    "team": "<team-id>",
    "project": "<project-id>",
    "title": "Project setup and initial architecture",
    "priority": 2,
    "state": "<backlog-state-id>"
  },
  {
    "team": "<team-id>",
    "project": "<project-id>",
    "title": "Core feature implementation",
    "priority": 2,
    "state": "<backlog-state-id>"
  },
  {
    "team": "<team-id>",
    "project": "<project-id>",
    "title": "Testing and documentation",
    "priority": 3,
    "state": "<backlog-state-id>"
  }
]
EOF

linear issues bulk-create --file /tmp/milestone-issues.json
```

Parse `created[].identifier` from the output to include issue identifiers in your summary.

## Step 5: Report Results

After creating everything, provide a summary:
- Project URL (from the project ID: `https://linear.app/[org]/project/[id]`)
- List of created issues with their identifiers
- Any recommendations for next steps

## Notes

- If the repository already has a Linear project linked (check README or `.linear/` directory), ask before creating a duplicate
- If the codebase spans multiple teams' concerns, consider creating separate projects per team
- Use `--icon` with an appropriate emoji if the project has a clear theme (e.g., 🔐 for auth, 🚀 for deployment, 📊 for analytics)
