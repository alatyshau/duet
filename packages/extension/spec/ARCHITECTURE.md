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

## Scanner Behaviors

| Behavior | Description |
|----------|-------------|
| Self-healing | Auto-creates `business.json` at roots, renames misplaced manifests |
| Recursive descent | Scans nested streams until product found |
| Product is terminal | On `product.json` found → stop, no manifests below product |
| Projects detection | Only from `{product}/projects/*` subfolders |

Implementation: `scanner.ts`. Name conflict resolution → see DOMAIN.md

## Testing

| Layer | Tool | Approach |
|-------|------|----------|
| `core/` | vitest | Unit tests with mock FileSystem |
| `vscode/` | @vscode/test-electron | Integration tests (planned) |
