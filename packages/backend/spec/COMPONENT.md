# Backend

Python HTTP backend serving REST API and MCP endpoint for Duet.

> Domain model (contexts, manifests, invariants), pointer file, DuetData/DuetConfig layout, cross-component contracts: see [/spec/PRODUCT.md](/spec/PRODUCT.md). This file documents only what Backend itself owns and exposes.

## Purpose

Backend is the system's strict reader and DB owner. It does not write manifests, does not migrate schemas, does not own backend lifecycle (Host does). It reads config + manifests → builds `entities.db` → exposes a typed surface over REST and MCP for AI agents and the Extension.

Three things Backend is the only authority for:
1. **The entity database.** SQLite at `DuetData/data/entities.db`, native sqlite3.
2. **Orientation.** Resolves a folder → its business (or its repo) → the text answer an agent starts a session with; the same rule picks the business for deploying instructions.
3. **Platform session prompt.** Builds `DuetData/duet.md` from the bundled `duet-core.md`.

## Architecture

### Module Map

```
server.py (entry point, lifecycle)
    │
    ├── mcp_handler.py       MCP tools, service getters
    ├── services/
    │   ├── workspace.py     WorkspaceService — folder → business, orientation answer
    │   ├── entities.py      EntitiesService — /contexts, /scan
    │   ├── deploy_instructions.py  deploy a context's skills/instructions/system_prompt into its Drive folder
    │   ├── at_paths.py      alpha-path grammar: form, repo/context heads, containment
    │   ├── resolve_paths.py agent-facing alpha-path resolver (repos / contexts / tickets) behind `resolve_paths`
    │   ├── tickets/         ticket operations behind `tickets`, `new_ticket`, `move_ticket`, `edit_ticket`
    │   └── manifest.py      strict v4 manifest reader
    ├── scanner.py           hierarchy scan, strict v4 reader
    ├── watcher.py           manifest file watcher, auto-rescan
    ├── description.py       extract_description (for /contexts), spec file lookup
    ├── instructions.py      platform session prompt builder
    ├── db.py                SQLite operations
    ├── config.py            read-only configuration
    ├── pointer.py           pointer file reader
    ├── aliases.py           @alias resolver
    ├── fileio.py            atomic_write()
    └── normalization.py     NFC paths

mcp_stdio_bridge.py          separate process: stdio ⇄ /mcp for Claude Desktop (stdlib only)
```

### Module Responsibilities

| Module | Does | Does NOT |
|--------|------|----------|
| `server.py` | HTTP routes, lifecycle, DI init, logging setup | Business logic |
| `mcp_handler.py` | MCP tool registration, service getters | DB access |
| `services/*.py` | Business logic, atomic file writes | Direct HTTP, MCP |
| `scanner.py` | Hierarchy scan (strict v4), `git_repos` → N product_repo while Drive context recursion continues; a repo declared by several contexts under one name and address is registered once | HTTP, config writes, manifest upgrades |
| `services/manifest.py` | Strict v4 manifest parsing (incl. optional `skills`/`instructions`/`memory`/`system_prompt` @-path declarations and the field-level `ticket_code`) | Migrations (Host owns) |
| `services/deploy_instructions.py` | Materialize a context's `skills` (`.claude/skills/<name>/` + `.agents/skills/<name>/`) + `instructions` (`.claude/CLAUDE.md` + `.kimi-code/AGENTS.md` + `.agents/rules/gemini.md`) + `system_prompt` (`.claude/output-styles/` + `outputStyle`, `.codex/config.toml` key, `.kimi-code/agents/agent.md`) into its Drive folder; idempotent | HTTP, @-path resolution policy, DB |
| `services/at_paths.py` | The one grammar of alpha paths, shared by deploy and `resolve_paths`: parse `@<head>/<rest>`, find the repo dir (under `DuetData/repos`) or context (→ its Drive folder) a head stands for, keep the target inside it; refuse `.` / `..` segments | Tickets, file copy, HTTP, DB |
| `services/resolve_paths.py` | Resolve agent alpha paths incl. tickets (`@DUE009`), explain every failure, render the tool's Markdown | DB (gets contexts from `WorkspaceService`), HTTP, manifest writes |
| `services/tickets/` | List, create, move and edit tickets; own the ticket folder name and the `INDEX.md` frontmatter; atomic writes with rollback | DB (gets contexts from `WorkspaceService`), HTTP, manifest writes, anything below the frontmatter |
| `watcher.py` | Watch manifest files, debounce, trigger rescan | DB, HTTP, config |
| `instructions.py` | Build the platform session prompt from duet-core.md | DB, HTTP |
| `description.py` | Extract description from markdown, spec file lookup | DB, HTTP |
| `db.py` | SQLite CRUD | Business rules |
| `pointer.py` | Read pointer file | Write pointer |
| `aliases.py` | Resolve `@alias` → absolute path | Config management |
| `config.py` | Read pointer + settings + machine config, path getters | Write config files |
| `mcp_stdio_bridge.py` | Standalone stdio ⇄ HTTP forwarder to `/mcp`, launched by Claude Desktop | Import any backend module or the MCP SDK |

### Boundaries (CRITICAL)

| Rule | Why |
|------|-----|
| `services/` never imports `server.py` | Layer isolation |
| `scanner.py` never imports `mcp_handler` | Domain isolation |
| `config.py` never writes files | Read-only contract |
| `db.py` never validates business rules | Just CRUD |

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Python (not TS) | Native sqlite3, DuckDB, LanceDB support |
| HTTP (not stdio) | One process owns DB, no race conditions |
| Services layer with DI | Testability, separation of concerns |
| Pointer-based config | Reads pointer → settings.json + {machine}.json |
| Strict v4 reader | Backend never silently coerces malformed manifests — Host owns migrations |

## Surface

### REST Endpoints

| Method | Path | Contract |
|--------|------|----------|
| GET | `/health` | `{ status, version, uptime_seconds }` |
| POST | `/stop` | `{ status: "stopping" }`, triggers shutdown |
| GET | `/timestamp` | `{ timestamp: "YYMMDD_HHMMSS<tz>" }` |
| GET | `/duet-data-path` | `{ path: "/absolute/path" }` |
| GET | `/contexts` | `{ contexts: [...] }` — `type='context'` entities. Each entity carries `absolute_path`, `git_url`, `git_repos` (map or `null`), `meta`, `reference_repos`, `description`. **Order: roots in `root_context_folders` config order; non-root siblings alphabetical by `name`** — see /spec/PRODUCT.md → Invariants |
| POST | `/scan` | `{ status, entities_count, duration_ms, errors[] }` |
| POST | `/deploy-instructions` | Body: `{"workspace_paths": [...]}`. Picks the business from the paths, deploys its `skills`/`instructions`/`system_prompt` declarations into its Drive folder (idempotent). Returns `{ status: "ok", deployed, warnings }` or `{ status: "unknown", reason }` — see Deploy Instructions below |
| POST | `/tickets/{action}` | `action` is `tickets`, `new_ticket`, `move_ticket` or `edit_ticket`; body is a JSON object of that operation's arguments. Runs the same code as the MCP tool of that name and returns `{ text, is_error, tickets }`: Markdown, whether the operation failed, and the tickets it looked up, created, moved or edited as `{ number, name, shelf, folder }`, so a client never parses the text. 404 for an unknown action, 400 for a body that is not a JSON object; a failed operation is HTTP 200 with `is_error: true` — see [Ticket tools](#ticket-tools) |
| POST | `/merge-duet-instructions` | Builds `duet.md` from the `duet-core.md` platform prompt. Returns `{ status, output_style, errors[] }` |

### MCP Tools

| Tool | Returns |
|------|---------|
| `timestamp` | string directly |
| `duet_data_path` | string directly |
| `turn_plan` | Plan text as unstructured content (prototype: one turn's checklist, stateless; `fmt` picks `md` / `html` / `line` / `plain`; `structured_output=False` keeps the client from showing a `{"result": ...}` envelope) |
| `resolve_paths` | Markdown text, one `### <path>` section per requested alpha path (see [Alpha-path resolution](#alpha-path-resolution-resolve_paths)); `structured_output=False`; empty list → `INVALID_PARAMS` |
| `turn_report` | The given report text unchanged, as unstructured content (prototype: one agent report on preparing the answer, free-form Markdown chosen by the caller; the first non-empty line must be a `### ` heading with text, otherwise `INVALID_PARAMS`; `structured_output=False` for the same reason as `turn_plan`) |
| `orientation` | Markdown text for one folder (see [Orientation](#orientation)); `structured_output=False` |
| `tickets` | Markdown: an overview of a business's tickets, a filtered list (`shelf`, `parent`), or one or more tickets by number (see [Ticket tools](#ticket-tools)); read-only; `structured_output=False` |
| `new_ticket` | Markdown: the new number, folder, stable `@NUMBER` address and the frontmatter written; not idempotent |
| `move_ticket` | Markdown: the new folder and, when a close or reopen date was recorded, the updated frontmatter; idempotent |
| `edit_ticket` | Markdown: what changed (with the previous values) and the updated frontmatter; idempotent |
| `business_tree` | Flat list of registered businesses linked by `id` / `parent_id`, with repository declarations; areas without their own manifest are not separate records |
| `scan` | dict directly |
| `health` | `{ status, version, uptime_seconds }` |

**Business discovery:** `business_tree` replaces the former MCP `contexts` tool; the old MCP name is no longer registered. This is an agent-facing rename only: `GET /contexts`, its response, the `contexts.json` cache, and `EntitiesService.get_contexts()` remain unchanged for Extension and Host consumers.

**Format note:** REST wraps in `{ key: value }` (extensibility); MCP returns data directly (AI convenience).

**Contracts:**
- `/stop` is REST-only — AI must not stop backend.
- Errors: `McpError` with JSON-RPC codes (`INVALID_PARAMS` -32602, `INTERNAL_ERROR` -32603).
- Empty result returns `[]`, not exception.

### MCP stdio bridge

`mcp_stdio_bridge.py` lets a client that can only launch stdio MCP servers reach `/mcp`. Claude Desktop is the one such client: Host registers `<DuetData>/.venv` Python + `<DuetData>/backend/mcp_stdio_bridge.py http://127.0.0.1:<port>/mcp/` in its `claude_desktop_config.json` (Host spec, *AI Clients*). It is not part of the server process — Desktop starts one bridge per connection, and the bridge talks to the running backend over HTTP like any other client.

| Contract | Behavior |
|----------|----------|
| Wire | Newline-delimited JSON-RPC on stdin/stdout, UTF-8; each message is POSTed to the URL as is. The answer (plain JSON, or SSE `data:` lines) is written back; `202` produces no output |
| Session | `Mcp-Session-Id` from the `initialize` answer and `MCP-Protocol-Version` from its result are sent on every later message; `DELETE` ends the session when stdin closes |
| Backend not up | Connection failures are retried for 30 s (Desktop starts at login, often before Host has started the backend; a deploy restarts it) |
| Backend restarted | A `404` (session forgotten) makes the bridge replay the client's own `initialize` on a new session, send `notifications/initialized`, and resend the request once; the replay's answer is not shown to the client. Concurrent requests share one replay. A failed replay keeps the stale session id, so the next message meets `404` again and retries (a message with no id gets `400`, which would never trigger a retry); a client `initialize` that failed is replayed before the next message |
| Failure | Any request the backend cannot answer still gets a JSON-RPC error (`-32603`) on its own id — never silence. Diagnostics go to stderr (Desktop: `mcp-server-duet.log`) |
| Concurrency | Requests run in parallel threads, so a long tool call does not hold up the rest; `initialize`, notifications and responses are forwarded in order |
| Not covered | The server→client GET stream: the backend answers with plain JSON (`json_response=True`) and never pushes on its own |

Standard library only, so it runs on any venv regardless of the installed MCP SDK version. Deployed with the rest of `packages/backend` (`**/*.py`). Tests: `tests/test_mcp_stdio_bridge.py` (against a fake `/mcp` that can forget sessions).

### Orientation

Contract — what the tool answers for which folder: [PRODUCT.md → Orientation](../../../spec/PRODUCT.md#orientation). Logic: `services/workspace.py`, `WorkspaceService.get_orientation(path)`. Below is only what the contract does not say.

- **Check order.** The input is NFC-normalized and resolved; `DuetData/repos` is checked before the venture folders.
- **`resolve_business(folder)`** is the one rule "folder → business", shared with Deploy Instructions. The folder's path relative to its venture folder is matched against `drive_path` with `db.find_closest_entity`, so the nearest registered context wins. A folder under `DuetData/repos` resolves to `None`.
- **Names after `@`** are the registered entity names (`МетаЛаб`), not folder names (`!МетаЛаб`).
- **Ticket code.** A business whose manifest declares `ticket_code` gets one line, `**Ticket code:** \`DUE\``, after the paths: it is the one thing about tickets an agent can't learn elsewhere.
- **Repo answer.** The repo is the first path segment under `repos`; a worktree folder `X.wt-N` stands for `X.git`; the `repos` folder itself is answered as outside Duet. `Declared by` is read from the manifests on disk of every context in the DB, because a shared repo has only one `product_repo` row (see Scanner).
- **Not registered.** A folder inside a venture folder for which the DB has no context — the venture has no valid manifest, or the first scan has not finished — is answered with ``Not a business folder: this path is inside a venture folder, but no business is registered for it. Run `scan` and call `orientation` again.``

### Ticket tools

Four operations let an agent work with tickets in one call each instead of listing folders, counting numbers and editing frontmatter by hand: `tickets` (read), `new_ticket`, `move_ticket` and `edit_ticket` (write). They have two entry points over one implementation: the MCP tools of those names for agents, and `POST /tickets/{action}` for the Extension. Logic: the `services/tickets/` package; `WorkspaceService.ticket_action` supplies the contexts from the DB and today's date in the configured timezone. This is the one place the Backend writes to a business's Drive folder. It still never writes manifests.

**Model.** A ticket is a folder `<number>_<Name>` under a business's `work/`, `backlog/` or `archive/`, found by the same walk as `resolve_paths` (`list_ticket_folders`), so a number the tools consider free is one the resolver can't find. Its metadata is the YAML frontmatter of its `INDEX.md`. The tools own the ticket's name and the frontmatter. The name lives in the folder name and in the title heading (the first `# ` line) of `INDEX.md`, and a rename changes both — where the heading contains the old name; a heading that doesn't mention it is left alone and reported. Everything else below the frontmatter is never modified. The frontmatter is edited line by line (`frontmatter.py`), never re-serialized, so untouched lines, comments, line endings and the body stay byte for byte.

**Rules the tools enforce.** Numbers: one past the highest in use, per kind (`DUE001`, `DUEX01` programs, `DUEA01` processes); gaps are never reused. Names: PascalCase (`naming.py`); the extension has no copy of this rule and creates and moves tickets through `POST /tickets/{action}`. An empty name makes a ticket with just its number. Parent: only a project has one, and it must be an open program or process of the same business; the business area is inherited from it. Dates: moving to the archive appends today to `closed`, moving out appends to `reopened`; a single date is a scalar, more are a list, nothing is overwritten. A program or process can't be closed while a ticket under it is open.

**Contract.**

- Every operation returns a `Result(text, is_error, tickets)`; `tickets` is the affected tickets as data, for clients that are programs. MCP maps `is_error` to `isError: true`; the text of a failure starts with `Error:` and says how to fix it. A batch lookup (`tickets(number=[...])`) that resolves at least one ticket is a success that names the numbers that failed.
- An error means nothing changed. Writes validate first, write `INDEX.md` atomically (temp file + `os.replace`), and roll back a folder move or creation when the write after it fails. If the rollback itself fails, the message describes the exact state left on disk.
- An `INDEX.md` that can't be read (I/O error, invalid UTF-8) is not an empty one: the ticket is listed as unreadable and can't be modified, and a folder that can't be listed fails the call rather than producing a partial list.
- `move_ticket` and `edit_ticket` are idempotent: asking for the state a ticket is already in succeeds with "No changes". `new_ticket` is not: a caller that doesn't know whether its call went through must look with `tickets` before calling again.
- Reads and writes share one lock (`model.disk_lock`): a read holds it while it lists the folders, a write for its whole duration. Without it a read that overlaps a move can find the ticket in neither place or in both. Taking the lock has a 20-second deadline, so an operation stalled on the drive makes the next ones fail with an error instead of queueing behind it forever.
- One-line fields (`description`, `area`, `icon`) are collapsed to a single line before they are written, and a description is limited to 300 characters: the Extension reads only the first 2 KB of `INDEX.md`, and `parent` is the last field. Frontmatter is split on line feeds only, never on U+2028 and similar, so pasted text can't turn into an extra field.
- A rewritten `INDEX.md` keeps its permissions. A read-only flag doesn't stop the tools: nothing in Duet sets it on a ticket, and where Duet does use it (deployed instruction files) it means "managed by Duet", which the frontmatter is.
- `tickets(number=[...])` gives each number its own section; a number that fails gets an `Error:` section and the first line counts the successes. The call is an error only when every number fails. Writes take one ticket per call.
- The MCP tools run the operation in a worker thread (`mcp_handler._ticket_tool`). Tickets live on a cloud-synced drive where a read can stall, and FastMCP would otherwise run a sync tool on the event loop and freeze every client. `tickets` gives up after 30 seconds with an error; writes have no deadline, because abandoning one halfway would leave its outcome unknown.
- Unknown arguments are rejected, with the same message on both entry points: `services.tickets.check_arguments` names the argument, suggests the closest valid one and lists the rest, and also refuses wrong types and missing required arguments. FastMCP's argument model ignores extra keys by default, so `mcp_handler._reject_unknown_arguments` wraps each tool's validation to run that check first and publishes `additionalProperties: false`; a misspelled argument can't fall back to a default on a tool that writes to disk.

**Arguments.** Values with a fixed set (`shelf`, `to`, `kind`) are published as an `enum` in the schema but accepted as plain strings, so that `"Archive"` reaches the service: it normalizes the case and answers an unknown value in the tools' own error format instead of a validation dump.

**Tests.** `tests/test_ticket_cases.py` runs every folder under `tests/ticket_cases/` (a starting tree, a call, the expected response, the expected changes on disk; index in `tests/ticket_cases/CASES.md`). Behavior changes start there: the case first, then the code. The same file holds `TestRollback` (failed writes, file permissions), `TestConcurrency` (reads during moves), `TestMcpBoundary` (strict arguments, `isError`, timeouts) and `TestFrontmatter`; the REST entry point is covered by `tests/test_api.py::TestTicketsEndpoint`. To check behavior on the real cloud drive rather than a local temp folder, point pytest's `--basetemp` at a scratch folder on the drive that lies outside every root context.

### Alpha-path resolution (`resolve_paths`)

The MCP tool `resolve_paths(paths)` resolves the alpha paths agents write (normative grammar: [PRODUCT.md → @Alias Resolution](../../../spec/PRODUCT.md#alias-resolution)). Logic: `services/resolve_paths.py`; `WorkspaceService.resolve_paths` feeds it the contexts from the DB and `<DuetData>/repos`. One call takes a list; every address gets its own result, and a failure in one never fails the call.

- **Head order:** repo dir under `DuetData/repos` → context name (canonical DB name, NFC; input is NFC-normalized) → ticket number `^[A-Z]{3}(\d{3}|[A-Z]\d{2})$`. `..` escaping the matched root is refused.
- **Tickets:** the owner is the one context whose manifest declares that `ticket_code`; codes are read **live** from the manifests on each call (not from the DB), so a code added a moment ago works without waiting for the watcher's rescan. The folder `<number>` / `<number>_*` is searched in the owner's `work/`, `backlog/`, `archive/` with up to 3 grouping levels (`archive/2026/09/`), never inside another ticket folder; state = first status dir; kind by the number's letter (`X` program, `A` process, none project); archive month from `YYYYMM` or `YYYY/MM`.
- **Missing file:** the absolute path is still returned (the agent may be creating it), with the nearest existing folder as an alpha path and an absolute path.
- **Refusals** (stable `error_code`, Russian message telling what to do): `not_alpha_path`, `dot_segment` (a `.` or `..` segment anywhere in the address), `unknown_head` (suggests an exact-case name when only the case differs), `escapes_root` (the target leaves its root, e.g. through a symlink), `ticket_not_found`, `ticket_ambiguous` (two folders with one number), `ticket_code_conflict` (code declared by 2+ contexts), `ticket_code_unregistered` — the tool searches every context for the folder and names the `context.json` and the exact line `"ticket_code": "XYZ"` to add; when the folder sits in a context with another code, it says so instead.
- **Output:** Markdown, no JSON, no resolution chain (decided in DUE009). A future HTTP endpoint would serialize the same `Resolution` objects.

### Deploy Instructions

`POST /deploy-instructions` with body `{"workspace_paths": [...]}` picks the business and materializes that context's `skills` / `instructions` / `system_prompt` declarations into its Drive folder. Idempotent — safe to call on every workspace open. Each path goes through `resolve_business`; when several businesses resolve, the meta-context (`meta=true`) wins, otherwise the first; when none does (a window with only repo folders), the answer is `no_owning_context`. Logic: `services/deploy_instructions.py`; service method `WorkspaceService.deploy_instructions` (per-context lock serializes concurrent calls).

**@-path resolution** (`services/at_paths.py`): `parse_at_path` takes `@<head>/<rest>` apart (`/` and `\` both separate segments, empty segments are dropped, text is compared in NFC), `find_base` resolves `<head>` to either a repo directory `<DuetData>/repos/<head>` (when it exists) or a context named `<head>` (→ that context's Drive folder), `join_under` keeps the target inside it. A `.` or `..` segment is refused anywhere in the address, because nothing needs one and leaving it to `Path.resolve()` once let `@..` reach the parent of the repos dir. `resolve_at_path` is those three for deploy declarations: a malformed, dotted, unknown or escaping entry resolves to `None` (warning + skip). The `resolve_paths` tool calls the same three and adds only ticket heads and its explanations; `tests/test_resolve_paths.py::TestSameGrammarAsDeploy` pins that both give one answer on every non-ticket address. Ticket heads are not accepted in deploy declarations.

**skills** (byte-for-byte copy into two targets: `<context>/.claude/skills/<name>/` for Claude Code and `<context>/.agents/skills/<name>/` for Kimi Code — cross-client convention):
- Absent key → not managed at all (either target). Present (even `[]`) → manage.
- Each declared @-path must be a directory containing `SKILL.md`; deploy-name = source dir name.
- Reserved name `.pruned` and deploy-name collisions are skipped with a warning.
- Not deployed, at any depth of the skill: directories named `tests`, `evals`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache` (`SKILL_EXCLUDED_DIRS`) — the skill's own test suite, eval set and dev caches, which a client never needs. Only directory names match, so a file `tests.md` or a singular `test/` still ships. A copy of them left by an earlier deploy is removed on the next one, like any entry the source dropped.
- Mirroring is **incremental**: a file is written only when its bytes differ, via temp-file + rename; entries the source dropped are removed. Contexts live on Drive, where deleting a file means "moved to Drive trash" and deploy runs on every window open — rebuilding the tree unconditionally filled the user's trash with every skill, many times a day.
- Deployed files are **read-only**: `0444`, or `0555` when the source file has the user x-bit (a skill may ship scripts meant to be run directly). Same reasoning as the instruction files — the whole tree is Duet-managed, so a hand edit here is reverted on the next window open; the source is the thing to edit. Directories keep their default mode, since the prune pass has to unlink inside them. A file whose bytes already match but whose mode doesn't is `chmod`-ed in place, never rewritten — a catch-up deploy over an existing tree costs no Drive revision.
- Prune (per target): any `<target>/skills/<x>` not in the declared set is moved into `<target>/skills/.pruned/<name>` (backup) before removal; `.pruned` is never itself pruned.

**instructions** (per-client dot-folder files inside the context folder: `.claude/CLAUDE.md` for Claude Code, `.kimi-code/AGENTS.md` for Kimi Code, `.agents/rules/gemini.md` for Antigravity):
- Composes the bodies of declared @-path sources (order preserved) into the per-client templates `packages/instructions/{CLAUDE,AGENTS,GEMINI}_template.md` at the `<!-- INSERT USER INSTRUCTIONS -->` marker.
- ALWAYS generates all three (templates carry the client-specific memory policy even with no user sources). Files written read-only (`0444`).
- A pre-existing hand-written file (lacking the `AUTO-GENERATED by Duet` banner) is backed up to `<name>.bak` once before the first overwrite.
- Legacy migration: root-level `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` (pre-dot-folder layout) carrying the banner are removed on deploy; hand-written ones are left untouched.

**system_prompt** (one @-path to a Claude output-style file; single source wired into three clients — normative description in [PRODUCT.md → Deploy Instructions](../../../spec/PRODUCT.md#deploy-instructions)):
- Claude Code: bannered read-only copy at `<context>/.claude/output-styles/<name>.md` (frontmatter kept at byte 0, banner right after it; `<name>` = frontmatter `name`, else the source file stem, validated `\w[\w.-]*`) + `outputStyle` in `.claude/settings.json`.
- Codex: `model_instructions_file` in `.codex/config.toml`, pointing at the Claude copy (relative to `.codex/`). Codex applies it only for a trusted project launched from the context folder (no `.git` → project root = launch dir).
- Kimi Code: `<context>/.kimi-code/agents/agent.md` — generated, frontmatter rewritten to `name: agent` + `override: true` (the project-scope override of Kimi's main-agent prompt), body = source body + a skeleton re-injecting `${agents_md}` / `${skills_section}` / `${additional_dirs_section}` / `${plugin_sections}`; `keep-coding-instructions: true` in the source swaps the skeleton for `${base_prompt}`.
- The files Duet writes whole — the style copy and the Kimi agent file — go through `_write_managed_if_changed`: read-only `0444`, `.bak` for a hand-written predecessor, no rewrite when already up to date.
- `.claude/settings.json` and `.codex/config.toml` are **not** in that set: they are shared with the user, so `_set_json_key` / `_set_toml_top_key` edit only Duet's key and leave the rest — including the file mode, which is the user's as much as the keys are. An existing file keeps whatever mode it has; only a file Duet creates gets a plain `0644`. The TOML edit is a single-line edit accepted only if `tomllib` parses the result to exactly the old data plus our key; otherwise the file is left untouched with a warning. Unparseable files likewise.
- **Absent key → withdraw** what carries the `AUTO-GENERATED by Duet` banner (generated style files; the Codex line, banner in its trailing comment; the Kimi agent file) and `outputStyle` only when it names a removed style. Hand-written files/keys are never touched. A renamed source prunes the previous generated style. Declared-but-unusable source → warning, current deployment left as is.

**Response:**
- `{ status: "ok", deployed: { skills_deployed: [...], skills_pruned: [...], agents_skills_deployed: [...], agents_skills_pruned: [...], instructions_written: [...], instructions_legacy_removed: [...], system_prompt_written: [...], system_prompt_withdrawn: [...] }, warnings: [...] }` when an owning context resolves.
- `{ status: "unknown", reason: "no_owning_context" | "no_context_manifest" }` when no owning context / manifest resolves.
- `400` (`BAD_REQUEST`) on invalid JSON body or non-list `workspace_paths`; `422` (`CONFIG_ERROR`) on backend config error.

### Timestamp Format

`/timestamp` and the MCP `timestamp` tool return `YYMMDD_HHMMSS<tz_id>` strings.

Examples: `260131_143052M` (Moscow), `260131_103052Z` (UTC).

Source: `timestampTZ` in `DuetConfig/settings.json` → `{id}` becomes the suffix.

### `/merge-duet-instructions` — Platform Session Prompt

`POST /merge-duet-instructions` builds `DuetData/duet.md` from the bundled `duet-core.md`. The endpoint keeps its existing name, but there is no agent registry, core insertion marker, or per-role output. Role instructions are explicit-only skills in the separate `duet-work` repository, not platform artifacts.

`merge_duet_instructions(core_prompt_path, output_dir, errors_path)` reads the source, prepends the provenance banner naming `@Duet.git/packages/instructions/duet-core.md`, and writes the prompt atomically. It writes build errors to `DuetData/data/duet-instructions-errors.json`; a clean rebuild clears that cache. The existing source-naming check still reports `version_suffix` warnings for Markdown files ending in `_vN`, excluding archived and development directories; those warnings do not fail the build.

**Response:** `{ status: "ok" | "error", output_style: "/absolute/path/to/duet.md" | null, errors: [{path, reason_code, description}] }`.

A source-read failure (`core_prompt_read_error`) or prompt-write failure (`prompt_write_error`) returns `error` with a null output path. Host must not deploy stale cached content after a failed build. A previous prompt is not deliberately removed on failure. Error-cache write failures propagate to the HTTP layer.

**Consumer:** Host reads `duet.md` from disk and deploys the same platform body to supported AI clients. Its configure-time migration removes retired, provenance-marked role files; Backend no longer produces or reads them.

## Behaviors

### Scanner

- Reads `root_context_folders` from `DuetConfig/settings.json` in declared order.
- Resolves `@aliases` via `{machine}.json` (see /spec/PRODUCT.md → @Alias Resolution).
- Strict v4 reader: never writes manifests; folders without `context.json` v4 silently skipped; `version != 4` produces `unrecognized_manifest_version` error.
- Stores results in `DuetData/data/entities.db` (native sqlite3).
- Deterministic order: `readdir` results sorted by name for reproducible scans.

**`/scan` behavior:**
- **Debounce:** if last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan", entities_count: 0, errors: [] }`. All scan responses conform to `ScanResult` shape (via `make_scan_result()` factory).
- **Blocking:** scan runs synchronously. During scan, backend does NOT respond to other requests. Typical duration: 1-5 seconds. OK because single-user local app.
- **Scan errors** in response: `{path, reason_code, description}`. Codes: `name_collision`, `repo_collision` (one repo name declared with different addresses; the same name with the same address is one shared clone, registered once under its first declarer), `invalid_manifest`, `unrecognized_manifest_version`, `invalid_ticket_code` (field dropped, context kept), `ticket_code_collision` (one per code declared by 2+ contexts; all stay registered). Backend never writes manifests; Host owns missing-file creation and version upgrades.
- **`run_scan_with_cache()`** (in `server.py`): shared function that runs scan + writes JSON cache (`scan.json`, `contexts.json`). Used by both `POST /scan` and ManifestWatcher.

### Manifest Watcher

Watches root context folders for changes to `context.json` manifests. On change — auto-rescan.

**Library:** `watchfiles` (async-native, Rust notify-rs). OS-level events: FSEvents (macOS), inotify (Linux), ReadDirectoryChangesW (Windows).

| Event | Action |
|-------|--------|
| Backend startup | If `root_context_folders` non-empty → initial scan + start watcher |
| Manifest file changed | Debounce 10s → `run_scan_with_cache()` |
| `POST /scan` completes | If folders changed → restart watcher |
| Backend shutdown | Stop watcher |

**Debounce:** 10s (watchfiles `debounce` parameter). On top of `EntitiesService` 5s debounce (10s > 5s, always passes).

**Filter:** `ManifestFilter` — only passes changes to files named `context.json`. All other filesystem events ignored.

**Folder tracking:** watcher watches specific folder paths. When `root_context_folders` change (add/remove via settings), `maybe_restart()` compares current vs new list and restarts if different.

**Data flow:** manifest changed → watcher → scan → `scan.json` / `contexts.json` updated → Host file watcher on `DuetData/data/` → UI refresh. No new IPC or endpoints.

Implementation: `watcher.py`.

### JSON Cache Pattern

Backend writes operation results to `DuetData/data/` as JSON files (atomic). Host's file watcher on `DuetData/data/` picks up changes and refreshes wizard state without HTTP polling. Extension does **not** consume these files — it uses HTTP (`GET /contexts`, `POST /scan`, `POST /deploy-instructions`) directly.

| File | Source | Consumer |
|------|--------|----------|
| `DuetData/duet.md` (shared platform session prompt) | `POST /merge-duet-instructions` | Host → Claude output-style + Codex/Antigravity system prompt |
| `DuetData/data/duet-instructions-errors.json` | `POST /merge-duet-instructions` | Host wizard |
| `DuetData/data/scan.json` | `POST /scan` | Host wizard |
| `DuetData/data/contexts.json` | `GET /contexts` / scan-completion sweep | Host wizard |

**Atomic write:** all files written via `.new` → rename → `.old` → delete. File watcher never sees half-written file. Implementation: `fileio.py:atomic_write()`.

### Description Extraction

Extracts description from markdown — first sentence of first paragraph after H1, or H1 text if next content is structural. Used by `description` in `GET /contexts` (from README.md, when the manifest has none).

**Legacy `find_spec_file()` fallback chain** (`ARCHITECTURE.md`, `INDEX.md`, `BUSINESS.md`, `STREAM.md`) has no caller in the Backend; the function is retained as a utility.

### Database Schema

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,                  -- 'context' | 'product_repo' | 'reference_repo'
    name TEXT,                  -- globally unique (see /spec/PRODUCT.md → Invariants)
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT,               -- populated only on product_repo / reference_repo rows
    meta INTEGER DEFAULT 0      -- 1 = meta-context (e.g. !БАЗА)
);
CREATE UNIQUE INDEX idx_name ON entities(name);
```

**v3 note:** `git_url` is no longer set on `context` rows — the URL lives in the `git_repos` map on disk and on `product_repo` children. The column stays on `product_repo` / `reference_repo` rows as the per-clone URL. No `components_repo` column is introduced.

`id` is identity, not ordering — `id ASC` happens to reflect scanner insertion order today, but the API contract for `/contexts` defines display order explicitly (see Surface → `/contexts`).

### Config Reading Order

```
pointer.py → ~/.org.ve68.duet
config.py  → DuetConfig/settings.json + {machine}.json
           → DuetData/backend/VERSION
```

**Backend-specific contracts:**
- `config.py` is read-only — never writes config files.
- `aliases.py:resolve_alias()` fails fast on unresolved alias (`AliasNotFoundError`).
- `config.get_version()` raises `ConfigError` if VERSION file not found.

### Lifecycle

**Startup:**

```
1. Read pointer file
2. setup_logging() → RotatingFileHandler
3. Validate config (VERSION, port, settings)
4. db.init()
5. Create services (DI)
6. init_services()
7. Initial scan + start manifest watcher (if root_context_folders non-empty)
8. Start uvicorn
```

**Shutdown:**

```
1. Receive SIGTERM/SIGINT or POST /stop
2. Set shutdown_event
3. Stop manifest watcher
4. db.close()
5. Exit
```

**Single-instance contract.** Backend does **not** use a PID file. Single-instance is guaranteed by Host (the only spawner) plus port binding — a second `uvicorn` on the same port fails fast with `EADDRINUSE`. `DuetData/.pid` is not written.

### Dependency Injection

```python
# server.py lifespan
db = DatabaseManager()
workspace_service = WorkspaceService(db)
entities_service = EntitiesService(db)
init_services(workspace_service, entities_service, _start_time)

# Usage (anywhere)
get_workspace_service().get_orientation(path)
```

**Contract:** services initialized once in lifespan. Never create new instances elsewhere.

### Logging

```
DuetData/backend.log  ← RotatingFileHandler
  Max size: 5 MB
  Backups: 1 (backend.log.1)
  Format: YYYY-MM-DD HH:MM:SS [LEVEL] message
```

## Engineering

### Python Environment

**One venv for monorepo:** at repo root (`.venv/`), shared by all Python packages.

```bash
.venv/bin/python    # interpreter
.venv/bin/pytest    # test runner
```

**Contract:** always use `.venv/bin/python`, never system Python.

### Testing

```bash
cd packages/backend && ../../.venv/bin/pytest
```

```
tests/
├── conftest.py          # Centralized fixtures
├── fixtures/
│   ├── entities.py      # EntityFactory
│   └── filesystem.py    # DuetDataBuilder, ManifestBuilder, HierarchyBuilder
└── test_*.py
```

| Fixture | Purpose |
|---------|---------|
| `duet_data` | Creates DuetData structure |
| `db` | DatabaseManager with test.db |
| `client` | Async HTTP test client (ASGI) |
| `EntityFactory` | Create Entity objects with defaults |
| `DuetDataBuilder` | Build custom DuetData structure |

**Contracts:**
- All tests use `tmp_path`. Never write to real DuetData.
- Use `EntityFactory` instead of raw `Entity()` construction.

### Running

```bash
python server.py                                          # reads ~/.org.ve68.duet
DUET_POINTER_FILE=/tmp/test-pointer python server.py      # test override
```

Backend has no standalone build — bundled into Host's `extraResources` (see [`host/spec/COMPONENT.md` → Engineering](../../host/spec/COMPONENT.md)).

### File Map

| Concept | File |
|---------|------|
| HTTP endpoints | `server.py` |
| MCP tools | `mcp_handler.py` |
| MCP stdio bridge | `mcp_stdio_bridge.py` |
| Folder → business, orientation answer | `services/workspace.py` (`resolve_business`, `get_orientation`) |
| Entity listing | `services/entities.py` |
| Hierarchy scan | `scanner.py:_scan_context()` |
| Manifest reader (strict v4) | `services/manifest.py:read_manifest()` |
| Deploy skills/instructions/system_prompt | `services/deploy_instructions.py:deploy_instructions()` |
| `@<name>/<rest>` resolution | `services/at_paths.py` (`parse_at_path`, `find_base`, `join_under`, `resolve_at_path`) |
| Agent alpha paths, tickets | `services/resolve_paths.py:resolve_paths()`, `WorkspaceService.resolve_paths()` |
| Ticket tools | `services/tickets/` (`views.py` read, `writes.py` write, `frontmatter.py`, `naming.py`, `model.py`), `WorkspaceService.ticket_action()` |
| Context-memory pointer | `services/workspace.py:_build_memory()` |
| Description extraction | `description.py:extract_description()` |
| Spec file fallback (legacy) | `description.py:find_spec_file()` |
| Merge pipeline | `instructions.py:merge_duet_instructions()` |
| Manifest watcher | `watcher.py:ManifestWatcher` |
| Scan + cache (shared) | `server.py:run_scan_with_cache()` |
| Atomic file write | `fileio.py:atomic_write()` |
| SQLite schema | `db.py:_init_schema()` |
| Config reading | `config.py` |
| Pointer reading | `pointer.py` |
| Alias resolution | `aliases.py` |
| Logging setup | `server.py:setup_logging()` |
