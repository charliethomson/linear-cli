# linear-cli

A command-line client for [Linear](https://linear.app), built for programs to call rather than
people to read. Every command emits compact JSON on stdout by default; `--human` renders tables
instead.

Linear has no official CLI. Its hosted MCP server is complementary rather than a replacement —
this tool is the fast local path, and it has bulk operations the MCP does not.

```bash
linear issues list --team ENG --limit 20
# {"data":[{"id":"...","identifier":"ENG-42","title":"...", ...}]}
```

## Install

```bash
npm install -g .
```

`dist/linear.js` is built automatically on install and is not checked in. Requires Node 18 or
newer.

## Authentication

A [Linear API key](https://linear.app/settings/api). Either export it:

```bash
export LINEAR_API_KEY=lin_api_...
```

or store it, which writes `~/.config/linear-cli/config.json` with mode `0600` inside a `0700`
directory:

```bash
linear auth set lin_api_...
```

The environment variable takes precedence. `linear auth status` reports which source is in use
and shows the key masked.

## Output contract

This is the part that matters if you are calling the CLI from a script or an agent.

| | |
|---|---|
| Success | `{"data": ...}` on **stdout**, exit **0** |
| Failure | `{"error": "...", "code": "..."}` on **stderr**, exit **1** |

`data` is an object or an array depending on the command. Errors never go to stdout, and a
successful command never writes to stderr, so the two streams can be read independently.

The JSON shape is a stable interface — changing it is a breaking change.

### Error codes

| Code | Meaning |
|---|---|
| `AUTH_MISSING` | No API key in the environment or the config file |
| `INVALID_KEY` | Key does not start with `lin_api_` |
| `KEY_NOT_FOUND` | `auth remove` found no stored key |
| `NOT_FOUND` | The entity genuinely does not exist |
| `INVALID_INPUT` | A malformed argument or input file |
| `MISSING_FIELDS` | An update command was given nothing to change |
| `FETCH_FAILED` | A read failed |
| `CREATE_FAILED` / `UPDATE_FAILED` | A mutation failed |
| `ARCHIVE_FAILED` / `DELETE_FAILED` | An archive or delete failed |

`NOT_FOUND` means the entity does not exist — a rate limit, an auth failure or a network fault
keeps its own identity rather than being reported as a missing entity.

## Global flags

Accepted before or after the subcommand.

| Flag | Effect |
|---|---|
| `--human` | Chalk-coloured tables instead of JSON. Renders scalar fields only, so nested objects (`state`, `assignee`, `labels`) are omitted — use JSON mode when you need them. |
| `--no-retry` | Fail on the first attempt instead of retrying rate-limited or transient failures. |

## Rate limiting

Linear rate-limits by request count and by query complexity. Every request is retried
automatically:

- **3 attempts**, exponential backoff with full jitter. `Retry-After` is honoured when sent,
  capped at 30s.
- **429 is always retried**, mutations included — the request was refused, so nothing was applied.
- **5xx is retried for reads only.** A write may have landed before the response was lost, so
  retrying `issues create` could duplicate an issue. Mutations fail fast on 5xx by design.

This matters most for the bulk commands, where `--concurrency` is what provokes rate limiting.

## Reference resolution

Two shorthands work anywhere the corresponding UUID is accepted, both case-insensitive:

- **Issue identifiers** — `ENG-123` in `issues get/update/comment/comments/archive/unarchive/
  delete`, `issues relations list/create`, `issues bulk-update`, and `cycles add-issues/
  remove-issues`.
- **Team keys** — `ENG` in every `--team` option, and in `teams get`.

Every other `--assignee`, `--state`, `--project`, `--label` and `--cycle` takes a UUID; discover
them with the corresponding `list` command.

## Commands

### Authentication and identity

```bash
linear auth set <api-key>       # store the key (0600)
linear auth remove              # delete the stored key
linear auth status              # source + masked value
linear me                       # the authenticated user
```

### Teams

```bash
linear teams list [--limit <n>]
linear teams get <id-or-key>
```

Returns `{id, name, key, description, timezone, private, issueCount, memberCount}`; `get` adds
`createdAt` and `updatedAt`. Linear exposes no `memberCount` scalar, so it is counted from the
members connection and capped at 250.

### Issues

```bash
linear issues list [--team <id|key>] [--project <id>] [--assignee <id>] [--state <id>]
                   [--priority <0-4>] [--label <id>] [--cycle <id>] [--search <text>]
                   [--limit <n>]
linear issues get <identifier>
linear issues create --team <id|key> --title <t> [options]
linear issues update <identifier> [options]
linear issues comment <identifier> --body <text>       # write one comment
linear issues comments <identifier> [--limit <n>]      # read the comment history
linear issues archive <identifier>
linear issues unarchive <identifier>
linear issues delete <identifier>                      # moves to Trash
linear issues bulk-create --file <path|-> [--concurrency <n>]
linear issues bulk-update --file <path|-> [--concurrency <n>]
linear issues relations list <identifier>
linear issues relations create --issue <id> --related <id> --type <blocks|duplicate|related>
linear issues relations delete <relation-id>
```

**Create / update options:** `--description <text>`, `--description-file <path>`,
`--description -` (stdin), `--priority <0-4>`, `--state <id>`, `--assignee <id>`,
`--project <id>`, `--label <id>` (repeatable), `--estimate <n>`.

**Clearing a field on `update`.** An omitted flag means "leave unchanged", so `none` clears:
`--assignee none` unassigns, `--project none` removes it from its project, `--estimate none`
clears the estimate, `--label none` removes all labels.

`--priority` must be an integer 0–4 and `--estimate` non-negative; anything else fails with
`INVALID_INPUT` rather than being silently coerced.

**`--label` on update replaces the whole label set** — pass every label you want to keep.

**Archived and trashed issues.** `issues delete` is a *soft* delete: it sets `trashed: true` and
`archivedAt`, and the issue is recoverable from Trash until Linear purges it. `issues archive`
sets `archivedAt` only. `issues list` excludes both, but `issues get` still resolves them — so
**check `trashed` and `archivedAt` before treating a `get` result as live.** A successful `get`
does not mean the issue is active.

`issues delete` prompts for confirmation only in `--human` mode.

**Relation types** are `blocks`, `duplicate` and `related`. `--issue blocks --related`; there is
no `blocked_by`, so invert the arguments. (`similar` exists in the API but is generated by
Linear's own suggestions.)

`--search` is a case-insensitive substring match on title or description, not full-text search.

#### Reading comments

`issues comments` is how a program replays what happened on an issue.

```json
{
  "data": {
    "issue": {"id": "...", "identifier": "ENG-123"},
    "comments": [
      {"id": "...", "body": "...", "createdAt": "...", "updatedAt": "...", "editedAt": null,
       "resolvedAt": null, "url": "...", "parentId": null,
       "user": {"id": "...", "name": "...", "email": "...", "displayName": "..."},
       "botActor": null}
    ],
    "hasMore": false
  }
}
```

- **Oldest-first**, so the history reads as a narrative. The API returns newest-first, so
  `--limit 10` selects the ten *most recent* and returns them chronologically.
- **`hasMore`** is true when more exist beyond what was returned.
- **`parentId`** is non-null on threaded replies.
- **`user` is null** for integration comments; `botActor` carries the actor instead.

#### Bulk operations

Prefer these over looping `issues create` for more than two issues.

```bash
linear issues bulk-create --file issues.json
linear issues bulk-create --file -                 # stdin
linear issues bulk-update --file updates.json --concurrency 10
```

`bulk-create` takes an array of `{team, title, description?, priority?, state?, assignee?,
project?, labels?, estimate?}`. `bulk-update` takes `{id|identifier, ...same fields}`.

```json
{"data": {"total": 5, "succeeded": 4, "failedCount": 1,
          "created": [{"id": "...", "identifier": "ENG-123", "title": "...", "url": "..."}],
          "failed": [{"input": {...}, "error": "..."}]}}
```

`bulk-update` returns `updated` in place of `created`.

**Partial failure does not abort, and still exits 0** — check `failedCount`, not the exit code.
`--concurrency` must be a positive integer.

### Projects

```bash
linear projects list [--team <id|key>] [--state <status>] [--limit <n>]
linear projects get <id>
linear projects statuses
linear projects create --name <n> --team <id|key> [--description <d>] [--color <hex>]
                       [--icon <emoji>] [--state <status>]
linear projects update <id> [--name <n>] [--description <d>] [--state <status>] [--color <hex>]
linear projects archive <id>
linear projects relations list <project-id>
linear projects relations create --project <id> --related <id> [--type dependency]
                                 [--anchor <start|end|milestone>]
                                 [--related-anchor <start|end|milestone>]
linear projects relations delete <relation-id>
```

Returns `{id, name, description, state, status, lead, color, icon, progress, startDate,
targetDate, createdAt, updatedAt}`. `status` is `{id, name, type}` and is authoritative; `state`
mirrors `status.type` for convenience because Linear has deprecated `Project.state`.

Status types are `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`. `--state`
accepts a type, a workspace status display name, or a UUID — run `linear projects statuses` to
see what this workspace actually defines.

Project relations accept only `--type dependency`. Anchors are `start`, `end` or `milestone` —
not `startDate`/`endDate`. `projects relations list` fetches workspace relations and filters
client-side, because the API's `projectRelations` query takes no filter.

### Cycles

```bash
linear cycles list --team <id|key>
linear cycles get <id>
linear cycles create --team <id|key> --starts <ISO-date> --ends <ISO-date> [--name <n>]
                     [--description <d>]
linear cycles update <id> [--name <n>] [--description <d>] [--starts <d>] [--ends <d>]
linear cycles add-issues <cycle-id> --issue <id> [--issue ...]
linear cycles remove-issues <cycle-id> --issue <id> [--issue ...]
```

Returns `{id, number, name, description, startsAt, endsAt, completedAt, progress,
issueCountTotal, issueCountCompleted, issueCountIncompleted}`.

Linear exposes no scalar issue counts on a cycle — only periodically-sampled history arrays that
read `0` for a cycle whose membership changed today — so the CLI tallies the issues live, costing
one extra query. `progress` is Linear's own estimate-weighted figure and will not always match
`issueCountCompleted / issueCountTotal`.

### Workflow states, labels, users

```bash
linear states list --team <id|key> [--limit <n>]
linear states create --team <id|key> --name <n> --type <type> --color <hex> [--description <d>]
linear states update <id> [--name <n>] [--color <hex>] [--description <d>]

linear labels list [--team <id|key>] [--limit <n>]
linear labels create --team <id|key> --name <n> --color <hex> [--description <d>]
linear labels update <id> [--name <n>] [--color <hex>] [--description <d>]

linear users list [--team <id|key>] [--limit <n>]
```

`states list` returns `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled` and
`duplicate`. `create --type` accepts only the middle five — `triage` and `duplicate` are managed
by Linear.

### Pagination

`issues list` and `issues comments` default to `--limit 50`; the other list commands default to
250. Linear caps a page at 250 and the CLI follows cursors above that, so `--limit 1000` works at
the cost of four round trips. `issues get` paginates an issue's `relations` too, so a long
blocking chain is not silently cut short.

## Versioning

The version is derived from git, never stored in a manifest:

```
VERSION = <tag MAJOR>.<tag MINOR>.<total commit count>
```

`MAJOR.MINOR` comes from the most recent `v[0-9]*` tag (the tag's own patch component is
ignored) and is the only manual knob — tag when you want a human-meaningful boundary.
Everything else rides the commit count, which is monotonic and never resets, so a higher
version always means a later commit.

`package.json`'s `version` is a static `0.0.1` placeholder and is **not** the source of truth;
don't bump it. `scripts/version.sh` does the derivation, and the build injects the result. CI
sets `RELEASE_VERSION` once per run, which takes precedence. Outside a git checkout — an install
from a packed tarball — it reports `0.0.0`.

See [standards/docs/versioning.md](standards/docs/versioning.md).

## Development

```bash
npm run dev -- issues list --team ENG   # run from source via tsx
npm run typecheck                       # sources and tests
npm test                                # builds, then runs the suite
npm run build                           # typecheck + bundle to dist/
npm run reinstall                       # build and reinstall globally
```

### Tests

The suite spawns the built `dist/linear.js` against a local fake GraphQL server rather than
mocking the SDK object. That is deliberate: an SDK mock keeps passing through a dependency
upgrade no matter what the SDK changes, whereas this exercises its real request construction and
response parsing — which is what caught the differences when `@linear/sdk` went from 32 to 89.

Tests never touch the network and need no API key. `LINEAR_API_URL` is the seam that points the
client at the fake; it is unset in normal use.

`test/known-bugs.test.ts` holds regression tests for the findings of the first review of this
tool. Most describe failures that were invisible from outside — commands that exited 0 having
done nothing, and errors that reported the wrong cause.

## Engineering standards

This repo vendors the shared standards at [`standards/`](standards/) (a git submodule) and is
registered as the `cli-tool` archetype. [`AGENTS.md`](AGENTS.md) is the entrypoint — it records
the deviations, which matter here because the archetype assumes Rust and this is a TypeScript
CLI.

```sh
git submodule update --init            # after cloning
standards/bin/standards sync           # pull newer standards
```

## Notes for agents

`ai/skills/linear.md` is the skill document describing this CLI for Claude Code, and is the
single source for it — `~/.claude/skills/linear/SKILL.md` symlinks here.

## License

ISC
