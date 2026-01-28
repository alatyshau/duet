# UI

## Views

| View | Purpose | Provider |
|------|---------|----------|
| КОНТЕКСТ | Current workspace position in hierarchy | `ContextProvider.ts` |
| ДЕЛА | Full business tree for navigation | `BusinessTreeProvider.ts` |
| ПРОЕКТЫ | Projects of selected product | `ProjectsProvider.ts` |
| Onboarding | Initial setup when data_folder not set | `OnboardingProvider.ts` |

## Visibility Contract

| View | Condition (`when` in package.json) |
|------|-----------------------------------|
| Onboarding | `!config.duet.data_folder` |
| КОНТЕКСТ, ДЕЛА, ПРОЕКТЫ | `config.duet.data_folder` |

## Behavioral Contracts

Things that are easy to accidentally break:

| View | Behavior | Why it matters |
|------|----------|----------------|
| ДЕЛА | Nodes expanded by default | User sees full hierarchy without clicking |
| ДЕЛА | Header `[МОИ ДЕЛА]` not collapsible | Visual anchor, not a real node |
| ДЕЛА | Placeholder when empty | User knows how to add first business |
| ДЕЛА | Icons: emoji in label | Consistent with Drive manifests |
| КОНТЕКСТ | Nodes always expanded | Breadcrumb should show full path |
| КОНТЕКСТ | Error nodes clickable → show help | User needs guidance on how to fix |
| ПРОЕКТЫ | Context source: active editor path (current) | Shows projects for current file's product |
| ПРОЕКТЫ | Icons: ThemeIcon (not emoji) | Distinguishes from ДЕЛА style |

## Error Codes (КОНТЕКСТ)

| Code | Meaning | User action |
|------|---------|-------------|
| `orphan` | Repo in repos/ but no matching product in DB | Add product.json on Drive |
| `name_conflict` | Repo name matches non-product entity | Rename repo or Drive entity |
| `outside_repos` | Repo not in DuetData/repos/ | Move to repos/ |
| `outside_hierarchy` | Folder not in any business | Add business via ДЕЛА |

## Future

- `duet.collapseAll` button in ДЕЛА
- ThemeIcon instead of emoji in label
- Worktree support in КОНТЕКСТ
- ПРОЕКТЫ context from ДЕЛА selection (not just active editor)
