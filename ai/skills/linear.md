# Linear CLI Skill

You have access to a `linear` CLI tool for interacting with a Linear project management instance.

## Setup

The CLI is available at `./dist/linear.js` (after building) or via `npm run dev -- <args>` during development.

If the tool is installed globally or in PATH, invoke it as `linear`. Otherwise use `./dist/linear.js`.

**Authentication**: The tool requires a Linear API key. Check status first:
```bash
linear auth status
```
If not configured, set it:
```bash
linear auth set lin_api_XXXX
```
`LINEAR_API_KEY` in the environment takes precedence over the stored config file.

## Output Format

**Default (AI mode)**: Compact JSON to stdout.
- Success: `{"data": {...}}` or `{"data": [...]}`
- Error (stderr): `{"error": "message", "code": "ERROR_CODE"}`
- Exit 0 on success, 1 on error

**Human mode** (`--human` flag): Chalk-colored tables and human-readable messages. Accepted
before or after the subcommand (`linear --human issues list` and `linear issues list --human`
both work). Human mode renders scalar fields only — nested objects (`state`, `assignee`,
`project`, `labels`) are omitted from tables, so use the default JSON mode when you need them.

Always use the default (AI mode) when running commands to parse results.

## Reference resolution

Two shorthands are accepted anywhere the corresponding ID is taken, and both are case-insensitive:

- **Issue identifiers** — `ENG-123` works in place of an issue UUID in `issues get`,
  `issues update`, `issues comment`, `issues archive`, `issues unarchive`, `issues delete`,
  `issues relations list/create`, `issues bulk-update`, and `cycles add-issues/remove-issues`.
- **Team keys** — `ENG` works in place of a team UUID in every `--team` option
  (`issues list/create`, `bulk-create` entries, `projects list/create`, `states list/create`,
  `labels list/create`, `users list`, `cycles list/create`) and in `teams get`.

Every other `--assignee`, `--state`, `--project`, `--label`, and `--cycle` option takes a UUID.
Discover those with `users list`, `states list`, `projects list`, `labels list`, `cycles list`.

## Commands Reference

### Authentication
```bash
linear auth set <api-key>    # Store API key (~/.config/linear-cli/config.json)
linear auth remove           # Delete stored key
linear auth status           # Show key source and masked value
```

### Current User
```bash
linear me                    # Returns: {id, name, email, displayName, active, admin, avatarUrl, createdAt}
```

### Teams
```bash
linear teams list                     # Returns array of teams
linear teams get <id-or-key>          # Get team by UUID or key (e.g. ENG)
```

Team object fields: `{id, name, key, description, timezone, private, issueCount, memberCount}`
(`teams get` also returns `createdAt`, `updatedAt`.)

Note: Linear exposes no `memberCount` scalar, so the CLI counts the members connection and
caps it at 250 — teams larger than that report 250.

### Projects
```bash
linear projects list [--team <id|key>] [--state <status>]
linear projects get <id>
linear projects statuses
linear projects create --name <n> --team <id|key> [--description <d>] [--color <hex>] [--icon <emoji>] [--state <status>]
linear projects update <id> [--name <n>] [--description <d>] [--state <status>] [--color <hex>]
linear projects archive <id>
linear projects relations list <project-id>
linear projects relations create --project <id> --related <id> [--type dependency] [--anchor <start|end|milestone>] [--related-anchor <start|end|milestone>]
linear projects relations delete <relation-id>
```

Project object fields: `{id, name, description, state, status, lead, color, icon, progress, startDate, targetDate, createdAt, updatedAt}`
- `status` is `{id, name, type}` — the authoritative value.
- `state` is the status **type**, kept as a convenience mirror. Linear has deprecated the
  underlying `Project.state` field; prefer `status.type`.

**Project status types**: `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`
(US spelling, one `l`). `--state` accepts a status type, a workspace status display name
(e.g. `In Progress`), or a status UUID. Run `linear projects statuses` to list what this
workspace actually defines — a workspace only has statuses it has configured.

Project relations: `--type` accepts only `dependency` (the API's sole relation type, and the
default). Anchors are `start`, `end`, or `milestone` — **not** `startDate`/`endDate`; both
default to `start`. A `milestone` anchor also needs a milestone ID, which this CLI does not
expose yet.

Note: `projects relations list` fetches the first 250 project relations in the workspace and
filters them client-side, because the API's `projectRelations` query takes no filter. It
requires a project UUID.

### Issues
```bash
linear issues list [--team <id|key>] [--project <id>] [--assignee <id>]
                   [--state <id>] [--priority <0-4>] [--label <id>] [--cycle <id>]
                   [--search <text>] [--limit <n>]
linear issues get <identifier>              # ENG-123 or UUID
linear issues create --team <id|key> --title <t> [options...]
linear issues update <identifier> [options...]
linear issues comment <identifier> --body <text>
linear issues archive <identifier>
linear issues unarchive <identifier>
linear issues delete <identifier>           # moves to Trash; prompts only in --human mode
linear issues bulk-create --file <path|-> [--concurrency <n>]
linear issues bulk-update --file <path|-> [--concurrency <n>]
linear issues relations list <identifier>
linear issues relations create --issue <id> --related <id> --type <blocks|duplicate|related>
linear issues relations delete <relation-id>
```

Issue create/update options:
- `--description <text>` — inline description
- `--description-file <path>` — read description from file (preferred for long markdown)
- `--description -` — read from stdin
- `--priority <0-4>` — 0=none, 1=urgent, 2=high, 3=medium, 4=low
- `--state <id>` — workflow state ID
- `--assignee <id>` — user ID
- `--project <id>` — project ID
- `--label <id>` — label ID (repeatable; on `update` this **replaces** all labels)
- `--estimate <n>` — story points

`issues list` returns, per issue:
`{id, identifier, title, priority, priorityLabel, estimate, state, assignee, project, labels, url, branchName, createdAt, updatedAt, dueDate, trashed, archivedAt}`
where `state` is `{id, name, type}`, `assignee` is `{id, name, email}`, `project` is `{id, name}`,
and `labels` is an array of `{id, name}`. Results are ordered by `updatedAt` descending.

`issues get` returns the same fields except `labels`, plus `description` and `relations`
(an array of `{id, type, relatedIssue}`).

**Archived and trashed issues**: `issues delete` is a *soft* delete — it sets `trashed: true`
and `archivedAt`, and the issue is recoverable from Trash in the Linear UI until Linear purges
it. `issues archive` sets `archivedAt` without `trashed`. `issues list` excludes both, but
`issues get <identifier>` still resolves them — so **check `trashed` / `archivedAt` before
treating a `get` result as a live issue**. A `get` that succeeds does not mean the issue is
active.

`--search` matches title or description (case-insensitive substring), not full-text search.

Issue relation types: `blocks`, `duplicate`, `related`. (`similar` also exists in the API enum
but is generated by Linear's suggestions rather than created by hand.) A `blocks` relation
means `--issue` blocks `--related`; there is no `blocked_by` — invert the arguments instead.

`--limit` defaults to 50. Linear caps a page at 250; the CLI auto-paginates above that, so
`--limit 1000` works but costs four round trips.

#### bulk-create

Creates multiple issues in parallel from a JSON array. Prefer this over looping `issues create` whenever you need to create more than 2 issues.

**Command:**
```bash
linear issues bulk-create --file /tmp/issues.json    # from file
linear issues bulk-create --file -                   # from stdin
linear issues bulk-create --file /tmp/issues.json --concurrency 10
```

**Input JSON schema** (array of issue objects):
```json
[
  {
    "team": "TEAM_ID",       // required — team UUID or key (e.g. ENG)
    "title": "...",          // required
    "description": "...",    // optional — markdown supported
    "priority": 2,           // optional — 0=none, 1=urgent, 2=high, 3=medium, 4=low
    "state": "STATE_ID",     // optional — workflow state UUID
    "assignee": "USER_ID",   // optional — user UUID
    "project": "PROJECT_ID", // optional — project UUID
    "labels": ["LABEL_ID"],  // optional — array of label UUIDs
    "estimate": 3            // optional — story point estimate
  }
]
```

**Output shape:**
```json
{
  "data": {
    "total": 5,
    "succeeded": 4,
    "failedCount": 1,
    "created": [{"id": "...", "identifier": "ENG-123", "title": "...", "url": "..."}],
    "failed": [{"input": {...}, "error": "..."}]
  }
}
```

**Workflow:**
```bash
# 1. Write your issue array to a temp file
cat > /tmp/issues.json << 'EOF'
[
  {"team": "ENG", "title": "Fix auth bug", "priority": 1, "state": "STATE_ID"},
  {"team": "ENG", "title": "Add rate limiting", "priority": 2}
]
EOF

# 2. Create all issues in one command
linear issues bulk-create --file /tmp/issues.json

# 3. Parse created[].identifier for the summary
```

Note: `bulk-create` never aborts on partial failure — it always returns full results including which issues failed and why.

#### bulk-update

Same file/stdin and concurrency handling as `bulk-create`. Each entry needs an `id` or
`identifier` (UUID or `ENG-123`), plus any of `title`, `description`, `priority`, `state`,
`assignee`, `project`, `labels`, `estimate`.

```bash
linear issues bulk-update --file /tmp/updates.json
```

```json
[
  {"identifier": "ENG-123", "state": "STATE_ID", "assignee": "USER_ID"},
  {"id": "uuid...", "priority": 1}
]
```

Output mirrors `bulk-create` but with an `updated` array in place of `created`.

### Workflow States
```bash
linear states list --team <id|key>
linear states create --team <id|key> --name <n> --type <type> --color <hex> [--description <d>]
linear states update <id> [--name <n>] [--color <hex>] [--description <d>]
```

State object fields: `{id, name, type, color, position, description}`

State types returned by `list`: `triage`, `backlog`, `unstarted`, `started`, `completed`,
`canceled`, `duplicate` (US spelling, one `l`).
`create --type` accepts only `backlog`, `unstarted`, `started`, `completed`, `canceled` —
`triage` and `duplicate` states are managed by Linear and cannot be created through the API.

### Labels
```bash
linear labels list [--team <id|key>]
linear labels create --team <id|key> --name <n> --color <hex> [--description <d>]
linear labels update <id> [--name <n>] [--color <hex>] [--description <d>]
```

Label object fields: `{id, name, color, description}`

### Users
```bash
linear users list [--team <id|key>]
```

User object fields: `{id, name, email, displayName, active, admin, avatarUrl}`

### Cycles
```bash
linear cycles list --team <id|key>
linear cycles get <id>
linear cycles create --team <id|key> --starts <ISO-date> --ends <ISO-date> [--name <n>] [--description <d>]
linear cycles update <id> [--name <n>] [--description <d>] [--starts <date>] [--ends <date>]
linear cycles add-issues <cycle-id> --issue <id-or-identifier> [--issue ...]
linear cycles remove-issues <cycle-id> --issue <id-or-identifier> [--issue ...]
```

Cycle object fields: `{id, number, name, description, startsAt, endsAt, completedAt, progress, issueCountTotal, issueCountCompleted, issueCountIncompleted}`

Note: Linear exposes no scalar issue counts on a cycle — only periodically-sampled history
arrays that read `0` for a cycle whose membership changed today. The CLI tallies the cycle's
issues live instead, so `list` and `get` each cost one extra query. `progress` is Linear's own
estimate-weighted figure and will not always match `issueCountCompleted / issueCountTotal`.

`add-issues` / `remove-issues` output `{cycleId, succeeded, failedCount}`.

## Common AI Workflows

### Discover context before creating issues
```bash
# 1. Get teams
linear teams list

# 2. Get workflow states for the team
linear states list --team ENG

# 3. Get labels available
linear labels list --team ENG

# 4. Get team members
linear users list --team ENG
```

### Create a project and initial issues
```bash
# Create project
linear projects create --name "My Feature" --team ENG --description "Feature description"

# Get the project ID from response, then create issues
linear issues create --team ENG --project <project-id> --title "Design API" --priority 2

# Create issue with rich markdown description from file
linear issues create --team ENG --title "Implement auth" --description-file /tmp/issue-body.md
```

### Bulk triage and labeling
```bash
# List high-priority issues
linear issues list --team ENG --priority 1

# Update an issue by identifier
linear issues update ENG-123 --state <in-progress-state-id> --assignee <user-id>
```

### Search and update
```bash
# Find issues mentioning a topic
linear issues list --team ENG --search "authentication" --limit 20

# Get full details
linear issues get ENG-123

# Add context as comment
linear issues comment ENG-123 --body "Related to the auth refactor in PR #456"

# Link them
linear issues relations create --issue ENG-123 --related ENG-456 --type related
```

## Error Handling

All errors are JSON on stderr with exit code 1:
```json
{"error": "No API key configured. Run: linear auth set <api-key>", "code": "AUTH_MISSING"}
```

Error codes:
- `AUTH_MISSING` — No API key set
- `INVALID_KEY` — API key does not start with `lin_api_`
- `KEY_NOT_FOUND` — `auth remove` found no stored key
- `NOT_FOUND` — Resource not found
- `INVALID_INPUT` — Malformed argument or input file
- `MISSING_FIELDS` — An update command was given no fields to change
- `FETCH_FAILED` — Read query failed
- `CREATE_FAILED` — Create mutation failed
- `UPDATE_FAILED` — Update mutation failed
- `ARCHIVE_FAILED` — Archive mutation failed
- `DELETE_FAILED` — Delete mutation failed

## Tips for AI Usage

1. **Always check `linear auth status`** before other commands to confirm auth is configured
2. **Use `--limit`** on issue lists to avoid overwhelming context (default: 50)
3. **Use `--description-file`** for long issue descriptions — write to a temp file first
4. **Parse JSON output** directly — all fields are consistent and documented above
5. **Team keys** (like `ENG`) and **issue identifiers** (like `ENG-123`) work anywhere the
   corresponding UUID is accepted — see "Reference resolution" above
6. **`issues delete` is a hard delete** and does not prompt in AI mode — prefer `issues archive`
7. **`--label` on `issues update` replaces the full label set**, so pass every label you want kept
