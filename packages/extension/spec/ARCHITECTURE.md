# Architecture

## Layer Separation

| Layer | Rule | Why |
|-------|------|-----|
| `core/` | No vscode imports | Testable with vitest, no VS Code runtime |
| `vscode/` | Wraps core/ with VS Code APIs | Thin glue layer |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| sql.js (WASM) | Works in VS Code extension sandbox, no native deps |
| write-file-atomic | Cross-platform atomic writes |
| FileSystem interface (`fs.ts`) | Dependency injection for testing without mocks |
| Deterministic scan order | `readdir` sorted by name for reproducible results |
| git clone via spawn | System git handles auth (ssh-agent, credential helper) |
| Workspace files | Multi-root workspace for repo + Drive folder |

## Scanner Behaviors

| Behavior | Description |
|----------|-------------|
| Self-healing | Auto-creates `business.json` at roots, renames misplaced manifests |
| Recursive descent | Scans nested streams until product found |
| Product is terminal | On `product.json` found → stop, no manifests below product |
| Projects detection | Any entity with `projects/` subfolder |

Implementation: `scanner.ts`. Name conflict resolution → see DOMAIN.md

## Launcher (openFolder.ts)

| Entity Type | Action |
|-------------|--------|
| Business/Stream | Open Drive folder directly |
| Product (no git_url) | Open Drive folder |
| Product (with git_url) | Clone if needed → generate workspace → open workspace |

Git clone UX:
- `withProgress` notification (cancellable)
- Output to "Duet Git" channel
- Uses `--progress` flag for real-time output
- Finalize pattern: single `resolved` flag prevents duplicate logs on cancel/error/close race

Implementation: `vscode/commands/openFolder.ts`, `core/workspace.ts`

## Workspace Generation

| Workspace | When Generated | Where |
|-----------|----------------|-------|
| `{Product}.code-workspace` | On each product open | `openFolder.ts` |
| `all-businesses.code-workspace` | After scan completes | `refresh.ts` |

## Tree Decorations

`TreeDecorationProvider.ts` uses VS Code FileDecorationProvider API to style tree items.

| URI Scheme | Format | Purpose |
|------------|--------|---------|
| `duet-tree` | `duet-tree:/<type>/<entityId>?active` | Enables color styling for tree nodes |

| Decoration | Color | When |
|------------|-------|------|
| Business | `charts.blue` | All business nodes |
| Active | `charts.red` | Currently loaded node (`?active` in URI) |

Note: Active color takes priority over business color.

## Building VSIX

```bash
cd packages/extension
npm run vsix
```

This script (`build-vsix.js`):
1. Bumps patch version (e.g. 0.0.5 → 0.0.6)
2. Updates viewContainer title to `Duet {version}`
3. Builds VSIX to `dist/duet-{version}.vsix`

## Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock FileSystem |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |
