# Domain

> Shared model (pointer file format, DuetData, DuetConfig): see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Role in Ecosystem

Host is the **only writer** of the pointer file. Extension and Backend only read it. See PRODUCT.md → Pointer File.

## AppState

Single source of truth for application status.

| Status | Condition |
|--------|-----------|
| `no_config` | Pointer file missing, or any of 3 required fields empty |
| `path_lost` | All fields present, but `duetDataPath` or `duetConfigPath` doesn't exist on disk |
| `ready` | All fields present AND both directories exist |

**Derivation:** `checkAppState()` reads pointer → checks fields → checks `existsSync()` → returns status.

## Config Interface

```typescript
interface Config {
  machine?: string
  duetDataPath?: string
  duetConfigPath?: string
}
```

Operations:
- `readConfig()` — reads pointer file, returns `{}` if missing or broken
- `writeConfig(config)` — writes pointer file (JSON, 2-space indent)
- `getConfigFile()` — returns pointer path (`DUET_CONFIG_FILE` env overrides for tests)

## Single Instance

Host uses Electron `requestSingleInstanceLock()`. Second instance shows window of the first and exits.

## Testability

| Module | Testable without Electron |
|--------|--------------------------|
| `core/config.ts` | Yes — pure fs, env override via `DUET_CONFIG_FILE` |
| `core/app-state.ts` | Yes — pure functions, depends only on config + fs |
| `platform/tray.ts` | No — requires Electron (manual testing) |
| `main/window.ts` | No — requires Electron |

## Implementation

| Concept | File |
|---------|------|
| Pointer read/write | `core/config.ts` |
| App state derivation | `core/app-state.ts` |
| IPC channels | `main/ipc-handlers.ts` |
| Tray icon/menu | `platform/tray.ts` |
| Autolaunch | `platform/autolaunch.ts` |
