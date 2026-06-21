---
name: python
description: Python code
---
# Skill: Python

Idiomatic Python following modern best practices.

## Quality Criteria

- Readable, explicit over implicit
- Type-hinted public API
- Proper error handling (specific exceptions)
- Clean structure (minimal utils)

## Sources

- PEP 8, PEP 20 (Zen of Python)
- "Fluent Python" (Luciano Ramalho)
- "Effective Python" (Brett Slatkin)

## Type Hints

```python
# Good
def process(items: list[str]) -> dict[str, int]:
    ...

# Avoid
def process(items):  # implicit Any
    ...
```

Use `typing` for complex types: `Optional`, `Union`, `TypeVar`, `Protocol`.

## Idioms

```python
# Unpacking
first, *rest = items

# Context managers for resources
with open(path) as f:
    ...

# Comprehensions over map/filter
squares = [x**2 for x in numbers if x > 0]

# EAFP over LBYL
try:
    value = data[key]
except KeyError:
    value = default
```

## Error Handling

```python
# Specific exceptions
except ValueError as e:
    ...

# Never bare except
except:  # Bad — catches SystemExit, KeyboardInterrupt
    ...

# Custom exceptions inherit from domain base
class DomainError(Exception): ...
class ValidationError(DomainError): ...
```

## Project Structure

```
package/
├── __init__.py
├── core.py        # Domain logic
├── cli.py         # Entry points
└── utils.py       # Helpers (minimize)
```

## Anti-patterns

- Mutable default arguments: `def f(items=[])`
- Wildcard imports: `from module import *`
- Bare `except:`
- Deep inheritance hierarchies
- `type()` instead of `isinstance()`

