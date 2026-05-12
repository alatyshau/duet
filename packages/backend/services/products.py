"""Product and component discovery (orientation §2 algorithm).

For a resolved context, build the `products[]` array — each product is a
software unit with optional `components`. Four discovery rules (§2.2):

- (A) Each alias in the context's `git_repos` map is a product whose
  filesystem root is the cloned repo folder.
- (B) `<context>/spec/PRODUCT.md` present → the context itself is a product.
- (C) `<sub>/spec/PRODUCT.md` present and `<sub>/context.json` absent →
  `<sub>` is a product of this context.
- (D) Fallback when A/B/C all fired empty: `<context>/README*.md` makes the
  context a single product.

Components live one level deep inside each product (§2.3) — four ordered
paths, first match wins:

  1. `<product>/packages/<comp>/spec/COMPONENT.md`
  2. `<product>/packages/<comp>/README*.md`
  3. `<product>/<comp>/spec/COMPONENT.md`
  4. `<product>/<comp>/README*.md`

Paths in the response are `@-ref` or relative (§3.4) — no absolute paths
escape this module. Resolution to absolutes is the consumer's job, via
`workspace.git_folders` and `workspace.context_folder`.
"""

from __future__ import annotations

from pathlib import Path

from description import extract_description


# Skip-list — folders never considered as products or components (§2.4).
# Constant; not extensible via manifest by design.
SKIP_FOLDERS: frozenset[str] = frozenset({
    # Duet workflow
    "drafts", "work", "archive", "ARCHIVE",
    # Build artifacts and dependencies
    "bin", "out", "dist", "build",
    "node_modules", "target", "__pycache__", ".venv", "venv",
    # Conventional non-component folders
    "src", "spec", "docs", "tests", "test", "examples",
})


def _is_skipped(name: str) -> bool:
    """True if folder name should be skipped at any traversal level."""
    if name.startswith("."):
        return True
    return name in SKIP_FOLDERS


def _find_readme(folder: Path) -> Path | None:
    """Return first README*.md per §2.5 priority.

    1. Exact `README.md` wins when present.
    2. Otherwise alphabetically-first `README*.md` (case-sensitive lex order).
    """
    if not folder.is_dir():
        return None
    candidates: list[Path] = []
    exact: Path | None = None
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        name = entry.name
        if name == "README.md":
            exact = entry
        elif name.startswith("README") and name.endswith(".md"):
            candidates.append(entry)
    if exact:
        return exact
    if candidates:
        return sorted(candidates, key=lambda p: p.name)[0]
    return None


def _build_component(product_root: Path, sub: Path) -> dict | None:
    """Try to interpret `sub` (one level under product_root) as a component.

    Returns a component dict on the first matching path, else None. Paths
    1/2 look at `<product>/packages/<sub.name>/...` (packages-form);
    paths 3/4 look at `<product>/<sub.name>/...` (direct form). The four
    paths are tried in design-doc §2.3 priority order; first match wins.
    """
    pkg_form = product_root / "packages" / sub.name
    direct_form = sub

    # Path 1
    spec1 = pkg_form / "spec" / "COMPONENT.md"
    if spec1.is_file():
        comp_path = f"packages/{sub.name}"
        desc = extract_description(spec1)
        result = {"name": sub.name, "path": comp_path, "spec": "spec/COMPONENT.md"}
        if desc:
            result["description"] = desc
        return result

    # Path 2
    pkg_readme = _find_readme(pkg_form) if pkg_form.is_dir() else None
    if pkg_readme:
        comp_path = f"packages/{sub.name}"
        desc = extract_description(pkg_readme)
        result = {"name": sub.name, "path": comp_path}
        if desc:
            result["description"] = desc
        return result

    # Path 3
    spec3 = direct_form / "spec" / "COMPONENT.md"
    if spec3.is_file():
        desc = extract_description(spec3)
        result = {"name": sub.name, "path": sub.name, "spec": "spec/COMPONENT.md"}
        if desc:
            result["description"] = desc
        return result

    # Path 4
    direct_readme = _find_readme(direct_form)
    if direct_readme:
        desc = extract_description(direct_readme)
        result = {"name": sub.name, "path": sub.name}
        if desc:
            result["description"] = desc
        return result

    return None


def _scan_components(product_root: Path) -> list[dict]:
    """Scan `product_root` one level deep for components.

    Order: alphabetical by subfolder name. Skip-list applies. The two
    "shapes" (packages/<comp>/ and <comp>/) are folded — if `packages/`
    exists, we iterate its children; otherwise we iterate `product_root`
    directly. When both forms could yield a component with the same name,
    the packages-form takes precedence per §2.3.
    """
    if not product_root.is_dir():
        return []

    # Enumerate the candidate subfolders. Each candidate is one shot — we ask
    # _build_component which form (packages/ or direct) actually applies.
    candidates: dict[str, Path] = {}

    # Direct-form children: product_root/<name>. `packages` is the monorepo
    # container — never a component itself (its children are, via packages-form).
    for entry in sorted(product_root.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or _is_skipped(entry.name):
            continue
        if entry.name == "packages":
            continue
        candidates.setdefault(entry.name, entry)

    # Packages-form children: product_root/packages/<name>
    packages_dir = product_root / "packages"
    if packages_dir.is_dir():
        for entry in sorted(packages_dir.iterdir(), key=lambda p: p.name):
            if not entry.is_dir() or _is_skipped(entry.name):
                continue
            # Packages-form takes precedence — overwrite the direct-form value
            # if the same component name appears in both.
            candidates[entry.name] = entry

    components: list[dict] = []
    for name in sorted(candidates):
        sub = candidates[name]
        comp = _build_component(product_root, sub)
        if comp:
            components.append(comp)

    return components


def _git_product(alias: str, git_folder: Path) -> dict:
    """Build a product entry for a `git_repos` alias (rule A).

    `alias` is the github repo name as declared in the manifest (e.g. `Duet`).
    The Duet-ontology entity for a git-backed product is `{alias}.git` —
    same slug as the clone folder on disk and the `product_repo.name` row
    in the DB. Drive-products (rules B/C/D) have no repo and therefore no
    `.git` suffix.
    """
    product: dict = {"name": f"{alias}.git", "path": f"@{alias}.git"}
    spec_path = git_folder / "spec" / "PRODUCT.md"
    if spec_path.is_file():
        product["spec"] = "spec/PRODUCT.md"
        desc = extract_description(spec_path)
        if desc:
            product["description"] = desc
    else:
        readme = _find_readme(git_folder)
        if readme:
            desc = extract_description(readme)
            if desc:
                product["description"] = desc
    product["components"] = _scan_components(git_folder) if git_folder.is_dir() else []
    return product


def _drive_product(
    name: str,
    folder: Path,
    at_ref: str,
    has_spec: bool,
    readme: Path | None = None,
) -> dict:
    """Build a product entry rooted on Drive (rules B/C/D)."""
    product: dict = {"name": name, "path": at_ref}
    if has_spec:
        spec_path = folder / "spec" / "PRODUCT.md"
        product["spec"] = "spec/PRODUCT.md"
        desc = extract_description(spec_path)
        if desc:
            product["description"] = desc
    elif readme is not None:
        desc = extract_description(readme)
        if desc:
            product["description"] = desc
    product["components"] = _scan_components(folder)
    return product


def build_products(
    context_name: str,
    context_folder: Path | None,
    git_folders: dict[str, str],
) -> list[dict]:
    """Build the `products[]` array for one context.

    Args:
        context_name: human name of the context (= entity name in DB).
        context_folder: absolute path to the context's Drive folder; may be
            None or non-existent for a missing-on-disk context.
        git_folders: map alias → expected absolute clone path. Includes
            every alias declared in the context's `git_repos` map; the
            path is the expected location (`{repos}/{alias}.git`) whether
            or not the clone exists on disk. Rule A is unconditional —
            every declared alias produces a product entry. If the clone
            is missing, the product gets `path` = `@<alias>.git` plus
            empty `components`, and `spec`/`description` are omitted.

    Returns:
        List of product dicts. Order: A (git_repos manifest order), then B
        (context as product), then C (subfolders, alphabetical). D fires
        only when A/B/C produced nothing.
    """
    products: list[dict] = []
    seen: set[str] = set()

    # Rule A — one product per `git_repos` alias.
    for alias, git_path_str in git_folders.items():
        if alias in seen:
            continue
        product = _git_product(alias, Path(git_path_str))
        products.append(product)
        seen.add(alias)

    folder_exists = context_folder is not None and context_folder.is_dir()

    # Rule B — <context>/spec/PRODUCT.md.
    if folder_exists and (context_folder / "spec" / "PRODUCT.md").is_file():
        if context_name not in seen:
            products.append(_drive_product(
                context_name,
                context_folder,
                f"@{context_name}",
                has_spec=True,
            ))
            seen.add(context_name)

    # Rule C — subfolders with spec/PRODUCT.md and no context.json.
    if folder_exists:
        subs = sorted(
            (e for e in context_folder.iterdir() if e.is_dir()),
            key=lambda p: p.name,
        )
        for sub in subs:
            if _is_skipped(sub.name):
                continue
            if (sub / "context.json").is_file():
                continue  # child context — its products belong to its own tree
            if not (sub / "spec" / "PRODUCT.md").is_file():
                continue
            if sub.name in seen:
                continue
            products.append(_drive_product(
                sub.name,
                sub,
                f"@{context_name}/{sub.name}",
                has_spec=True,
            ))
            seen.add(sub.name)

    # Rule D — fallback when A/B/C produced nothing.
    if not products and folder_exists:
        readme = _find_readme(context_folder)
        if readme:
            products.append(_drive_product(
                context_name,
                context_folder,
                f"@{context_name}",
                has_spec=False,
                readme=readme,
            ))

    return products
