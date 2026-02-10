# Skill: TypeScript

Idiomatic TypeScript for modern applications.

## Quality Criteria

- Type-safe, no `any` without justification
- Exhaustive discriminated unions
- Explicit return types on exports
- Clean barrel exports

## Sources

- "Effective TypeScript" (Dan Vanderkam)
- TypeScript Handbook
- ts-reset patterns

## Type Safety

```typescript
// Explicit return types on public API
function calculate(input: number): Result {
  ...
}

// Use unknown over any
function parse(data: unknown): Config {
  if (isConfig(data)) return data;
  throw new Error('Invalid config');
}

// Discriminated unions
type Result =
  | { status: 'success'; data: Data }
  | { status: 'error'; error: Error };
```

## Patterns

```typescript
// Const assertions for literals
const MODES = ['read', 'write'] as const;
type Mode = typeof MODES[number];

// Exhaustive checks
function handle(result: Result): void {
  switch (result.status) {
    case 'success': return process(result.data);
    case 'error': return log(result.error);
    default:
      const _exhaustive: never = result;
  }
}

// Branded types for domain safety
type UserId = string & { readonly brand: unique symbol };
```

## Project Conventions

```typescript
// Barrel exports
// index.ts
export { UserService } from './user-service';
export type { User, UserConfig } from './types';

// Separate type imports
import type { Config } from './types';
import { parseConfig } from './parser';
```

## Anti-patterns

- `any` without justification
- Type assertions (`as`) without validation
- Implicit return types on exported functions
- `@ts-ignore` without comment
- Enums (prefer unions or const objects)

