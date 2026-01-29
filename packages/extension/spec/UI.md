# UI

## Views

| View | Purpose | Provider |
|------|---------|----------|
| КОНТЕКСТ | Current workspace position in hierarchy | `ContextProvider.ts` |
| ДЕЛА | Full business tree for navigation | `BusinessTreeProvider.ts` |
| ПРОЕКТЫ | Projects of selected entity | `ProjectsProvider.ts` |
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
| ДЕЛА | Header has hover icon → open all-businesses workspace | Quick access to multi-root |
| ДЕЛА | Placeholder when empty | User knows how to add first business |
| ДЕЛА | Icons: emoji from manifest in label (e.g. `🔬 МетаЛаб`) | Custom icons from manifests, no ThemeIcon |
| ДЕЛА | Description: type label (бизнес/дело/продукт) | User sees entity type |
| ДЕЛА | Description: `[git]` marker for products with git_url | User sees which products have repos |
| ДЕЛА | Current node marker `●` | User sees what's open in this window |
| ДЕЛА | Toggle button (fold icon) | Single button to expand/collapse all |
| ДЕЛА | Click = select, arrow = toggle | User can select without collapsing |
| ДЕЛА | Excludes projects | Projects only in ПРОЕКТЫ section |
| КОНТЕКСТ | Welcome view when no folder open | User knows how to open folder |
| КОНТЕКСТ | Settings via submenu (not QuickPick) | Faster access, no intermediate dialog |
| КОНТЕКСТ | Nodes always expanded | Breadcrumb should show full path |
| КОНТЕКСТ | Error nodes clickable → show help | User needs guidance on how to fix |
| ПРОЕКТЫ | Context source: ДЕЛА selection | Shows projects for selected entity |
| ПРОЕКТЫ | Icons: ThemeIcon (not emoji) | Distinguishes from ДЕЛА style |

## Error Codes (КОНТЕКСТ)

| Code | Meaning | User action |
|------|---------|-------------|
| `orphan` | Repo in repos/ but no matching product in DB | Add product.json on Drive |
| `name_conflict` | Repo name matches non-product entity | Rename repo or Drive entity |
| `outside_repos` | Repo not in DuetData/repos/ | Move to repos/ |
| `outside_hierarchy` | Folder not in any business | Add business via ДЕЛА |

## Future

- Worktree support in КОНТЕКСТ
