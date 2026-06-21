---
name: idef0
description: Create, review, and format IDEF0 models using the IDEFy `.idef0` DSL.
---
# Skill: IDEF0

Write valid `.idef0` files in the IDEFy DSL — one file per decomposition sheet, with correct arrow roles, interface contracts between levels, and project layout under `src/idef0/`.

## Quality Criteria

- Arrow roles match IDEF0 semantics: `I/O` are material/information that flows through and changes, `C` governs the activity without being consumed, `M` performs the activity.
- Decomposition mirrors the file tree: one `.idef0` file per decomposed activity, atomic activities stay as blocks inside the parent.
- Interface contract between parent and child is exact: the child file's boundary arrows match the IDs and meanings of what the parent consumes and produces for that block.
- Output is a complete, self-contained file tree ready to drop into `src/idef0/`, with no `;` terminators, no comments inside declarations, and no text after the closing `}`.

## Arrow Roles: I / C / M / O

LLMs routinely confuse `C` (Control) with `M` (Mechanism), and `I` (Input) with `C`. Lead with contrasts:

| `C` (Control) | `M` (Mechanism) |
|---|---|
| Recipe | Barista |
| Building code | Inspector |
| Pricing policy | Sales representative |
| Compliance checklist | Compliance officer |
| SLA agreement | Engineer on call |

| `I` (Input, gets transformed) | `C` (Control, governs but unchanged) |
|---|---|
| Customer request | SLA agreement |
| Roasted beans | Brewing recipe |
| Raw log file | Parsing schema |

**Definitions:**

- `I` — material or information **consumed and transformed** into outputs. It physically/logically changes during the activity.
- `O` — material or information **produced** by the activity.
- `C` — rules, standards, policies, recipes — **what shapes the activity** but is not consumed. After the activity runs, the control is still there, unchanged.
- `M` — resources that **perform** the activity: people, roles, tools, software, equipment. Mechanisms execute, controls direct.

**Test for `C` vs `M`:** if the arrow is a *person, role, tool, or running system*, it's `M`. If it's a *document, rule, standard, or specification*, it's `C`. A spec written by a person is still `C`; the person who wrote it is `M` of the authoring activity, not this one.

**Test for `I` vs `C`:** if the activity changes the thing or consumes it, it's `I`. If it only reads or follows it, it's `C`.

## Naming Activities

- Verb-led: `"Brew coffee"`, not `"Coffee"`. `"Process onboarding request"`, not `"Onboarding"`. (Language follows the user — Russian, English, any — only the verb-form discipline is universal.)
- Name the transformation: the title should make the I→O delta visible.
- Keep it short and in the domain language the user already uses elsewhere in the project.

## When to Decompose

Decompose a block (give it its own `Aₓ.idef0` file) when:

- The block contains more than ~5 sub-steps you could enumerate, **or**
- The block is handed off to a different actor (different `M`), **or**
- The block runs on a different rhythm or boundary (real-time vs batch, sync vs async).

Otherwise keep it atomic — no file, just a row in the parent's decomposition section.

## Writing Declarations

The DSL has no `;` and no separator between declarations. Each declaration starts on its own line with a prefix that identifies it:

- In an `activity` body: `I*` / `O*` / `C*` / `M*` (boundary arrows), then `A*` (functional blocks).
- In a `context A-0` body: `T*` (tunnel) or `...A0` (root reference).

**Boundary section first, then decomposition.** Inside `activity`, write all boundary arrows (`I/O/C/M`), then a blank line, then all functional blocks (`A*`). Never put a boundary arrow after the first `A*` line.

**Continuations.** If a functional block doesn't fit on one line, break after `:`, `->`, or `,` and indent continuations one tab deeper:

```idef0
    A1 "Analyze project"
        : I1, C1
        ->
            X11 "Process name",
            X12 "Inputs",
            X13 "Outputs"
```

**Comments.** Use `# ...` only between declarations or at the file top. Never inside a declaration body — a `#` line cuts the current declaration off.

**Text after `}`.** Don't write any. The file ends at the closing `}` of the header.

**String literals.** Double quotes only. Escape inner `"` as `\"`. Single quotes are regular characters.

## Activity and Block IDs

- Root activity of every model is always `A0`.
- Child blocks: `A1`, `A2`, …, `A9`, `AA`, `AB`, …, `AZ`. Suffix alphabet is `[1-9A-Z]+` — uppercase letters and digits 1–9 only. `0` is reserved for the root: `A10`, `A20`, `A1Z0` are invalid.
- Grandchildren concatenate: `A11`, `A1A`, `A1Z`, `A11A`, …
- Up to 9 blocks per activity is the IDEF0 norm. 10–35 is allowed but a sign the activity is wrong-grained. More than 35 per activity is invalid — if you need that many, the activity is wrong-grained and must be split first.
- Separate models never use `B0`, `C0`. Create sibling projects, each with its own `A0`.

A block gets its own `.idef0` file **only if it's decomposed** (see *When to Decompose*).

## Functional Block Syntax

```idef0
A1 "Block name" : <consumed arrows> -> <produced arrows>
```

**Consumed (left of `->`):**

- Parent boundary `I*`/`C*`/`M*` consumed by bare ID: `I1`, `C1`, `M1`.
- Internal arrows from sibling blocks and tunnels require an explicit role prefix: `I[X11]`, `C[X11]`, `M[X11]`, `I[T1]`, `C[T1]`, `M[T1]`. The same `X` or `T` arrow can play different roles for different consumers, so the role must be stated.
- Never consume `O*`. Outputs leave the sheet, they don't enter blocks.

**Produced (right of `->`):**

- `X11 "Description"` — a new internal arrow on this sheet.
- `X11[O1]` — internal arrow mapped to parent output `O1`. Name and description come from `O1`.
- `X11[T1]` — internal arrow tunnelled out through project tunnel `T1`.

Always use `X*` on the produced side, even if no block consumes it yet. Producing `O*` or `T*` directly is invalid.

## Tunnels

Tunnels (`T*`) carry context that crosses sheets without becoming a parent output — typically external constraints (regulations, ambient state, environmental flows).

- Declare each tunnel exactly once in `A-0.*.idef0`.
- Every declared tunnel must be used somewhere in the project (as `X*[T*]` produced or `I/C/M[T*]` consumed).
- On a single sheet, a tunnel cannot be both produced and consumed. Same-sheet flow is an internal `X*`, not a tunnel.
- On the same sheet, a tunnel can be consumed by several blocks in different roles.
- Across sheets, a tunnel can play different roles. The role is not fixed at declaration time.

## Interface Consistency Between Levels

When block `A1` in parent `A0` has its own file `A1.*.idef0`, the child header's boundary arrows must match what the parent declares for `A1`:

- Every `I*`/`C*`/`M*` the parent feeds `A1` appears as a boundary arrow of the same ID in the child.
- Every parent output `A1` reaches via `X*[O*]` appears as an `O*` boundary arrow in the child.
- The child's internal `X*` namespace is independent of the parent's.

Before writing a child file, copy the parent's declaration of the block and derive the boundary from it. Don't invent.

## Project Layout

A project is a connected subtree under `src/idef0/`. Its root folder contains `A0.*.idef0` (the marker) and `A-0.*.idef0` (the context).

```text
src/idef0/<domain>/<model>/
    A-0.idef0
    A0.idef0
    A1.idef0          # only if A1 is decomposed
    A11.idef0         # only if A11 is decomposed
    ...
```

**Path rules from `src/idef0/` to the project root:**

- At least one folder between `src/idef0/` and the project root. `src/idef0/A0.idef0` is invalid.
- Folder names on this path are Java-package style: `[a-z][a-z0-9_]*`. No dots, hyphens, uppercase, or non-ASCII.
- Project name is computed from this path with `/` → `.`: `src/idef0/coffee/brewing/` → `coffee.brewing`.

**Inside the project root:**

- Subfolders are free — for human navigation only. Flat, decomposition-mirroring, or business-phase layouts all work.
- Folder names inside the project root can use any characters allowed in file names (including dots after the ID, like `A1.Accept/`).
- No nested second `A0.*.idef0` anywhere in the subtree — projects don't nest.
- Sibling models (AS-IS / TO-BE) live in sibling project folders, each with its own `A-0` and `A0`. Never `B0`, `C0`.

## File Names

```text
<ID>[.<cosmetic>].idef0
```

- ID before the first dot must equal the `activity` or `context` ID inside the file.
- Cosmetic text after the first dot is optional, for human navigation. May contain letters of any alphabet, digits, `_`, `-`. No spaces, dots, slashes, or quotes.

Examples: `A0.idef0`, `A0.Order_intake.idef0`, `A11.Validate-request.idef0`, `A1.Onboarding.idef0`.

## Canonical Layout

Inside `activity` and `context` bodies, one declaration per line. For functional blocks, when several short blocks sit next to each other, align `:` and `->` into columns and group consumed arrows by role (`I` → `C` → `M`) so the sheet reads like a small table:

```idef0
activity A0 "Brew coffee" {
    I1 "Roasted coffee beans"
    I2 "Filtered water"
    O1 "Cup of coffee"
    O2 "Spent grounds"
    C1 "Recipe"
    C2 "Target TDS"
    M1 "Barista"
    M2 "Grinder"
    M3 "Temperature-controlled kettle"
    M4 "Dripper and filter"

    A1 "Grind beans"    : I1,     C1,     M1, M2 -> X11 "Ground coffee", X12[T1]
    A2 "Prepare water"  : I2,     C1,     M3     -> X21 "Water at target temperature"
    A3 "Extract coffee" : I[X11], C1, C2, M1, M4 -> X31[O1], X32[O2]
}
```

Within each role, sort bare IDs before bracketed references (`I1, I2, I[T1], I[X11], I[X22]`). Never split an ID or string literal across lines. When a block grows long, prefer multi-line continuation (see *Writing Declarations*) over a wider table.

## Complete Minimal Example

```text
packages/samples/src/idef0/coffee/brewing/
    A-0.idef0
    A0.idef0
```

```idef0
# packages/samples/src/idef0/coffee/brewing/A-0.idef0

context A-0 "Coffee brewing context" {
    T1 "Office noise"

    ...A0
}
```

```idef0
# packages/samples/src/idef0/coffee/brewing/A0.idef0

activity A0 "Brew coffee" {
    I1 "Roasted coffee beans"
    I2 "Filtered water"
    O1 "Cup of coffee"
    O2 "Spent grounds"
    C1 "Recipe"
    C2 "Target TDS"
    M1 "Barista"
    M2 "Grinder"
    M3 "Temperature-controlled kettle"
    M4 "Dripper and filter"

    A1 "Grind beans"    : I1,     C1,     M1, M2 -> X11 "Ground coffee", X12[T1]
    A2 "Prepare water"  : I2,     C1,     M3     -> X21 "Water at target temperature"
    A3 "Extract coffee" : I[X11], C1, C2, M1, M4 -> X31[O1], X32[O2]
}
```

## Checklist

Before handing the model back:

- Every `C` is a rule/document, every `M` is a person/tool/system. Run the C-vs-M test on each.
- Every parent output is reached via `X*[O*]`. No block produces `O*` or `T*` directly.
- Every block that has its own file matches the parent's declaration exactly in `I/C/M/O` IDs.
- Every `T*` is declared in `A-0` and used somewhere; no tunnel is both produced and consumed on one sheet.
- Filename ID equals the header ID. Activity ID suffixes use only `[1-9A-Z]+`.
- No `;`, no `#` inside a declaration body, no text after the closing `}`.

## Anti-patterns

- Adding `;` to the end of any declaration — the DSL has no terminator.
- Putting a `#` comment between `:` and the end of the produced list — it terminates the declaration.
- Placing a boundary arrow (`I*`/`O*`/`C*`/`M*`) after the first `A*` block in the same body.
- Using `0` inside an activity-ID suffix (`A10`, `A20`, `A1Z0`).
- Putting `A0.idef0` directly in `src/idef0/`, or nesting a second `A0.*.idef0` inside an existing project.
- Using uppercase, hyphenated, dotted, or non-ASCII folder names on the path from `src/idef0/` to the project root.
- Creating `B0` or `C0` for additional models instead of sibling projects.
- Creating a separate file for a block that has no decomposition.
- Consuming `X*` or `T*` without an `I[…]` / `C[…]` / `M[…]` role prefix.
- Consuming `O*` directly on the left of `->`.
- Producing `O*` or `T*` directly instead of mapping from an `X*`.
- Declaring a tunnel in an activity file instead of in `A-0`.
- Decomposing `A-0` — it's a context container, not an activity.
- Calling a person/tool a `C` (e.g. listing `"Barista"` as a control) or a rule/recipe an `M` (e.g. listing `"Recipe"` as a mechanism).
- Letting a child file invent boundary arrows that don't match what the parent declares for that block.
