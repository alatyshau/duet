"""Tests for `services.products.build_products` — orientation §2 algorithm.

Four discovery rules (§2.2):
  A — each alias in `git_repos`
  B — `<context>/spec/PRODUCT.md`
  C — `<sub>/spec/PRODUCT.md` without `<sub>/context.json`
  D — README fallback when A/B/C all empty

Components scan one level deep with the four ordered paths (§2.3); skip-list
applies to every level (§2.4); README*.md uses exact-then-alphabetical
priority (§2.5).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.products import build_products, SKIP_FOLDERS


# --- Rule A: each git_repos alias is a product -----------------------------


class TestRuleA:
    def test_rule_A_each_git_alias_is_product(self, tmp_path: Path) -> None:
        """N `git_repos` aliases → N products."""
        ctx = tmp_path / "Lab"
        ctx.mkdir()
        repo_a = tmp_path / "repos" / "A.git"
        repo_b = tmp_path / "repos" / "B.git"
        repo_a.mkdir(parents=True)
        repo_b.mkdir(parents=True)

        products = build_products(
            "Lab", ctx,
            git_folders={"A": str(repo_a), "B": str(repo_b)},
        )

        names = [p["name"] for p in products]
        assert names == ["A.git", "B.git"]
        assert products[0]["path"] == "@A.git"
        assert products[1]["path"] == "@B.git"

    def test_rule_A_description_from_spec_then_readme(self, tmp_path: Path) -> None:
        """spec/PRODUCT.md wins over README*.md for git products."""
        ctx = tmp_path / "Lab"
        ctx.mkdir()

        repo_spec = tmp_path / "repos" / "WithSpec.git"
        (repo_spec / "spec").mkdir(parents=True)
        (repo_spec / "spec" / "PRODUCT.md").write_text(
            "# WithSpec\n\nFrom spec.", encoding="utf-8",
        )
        (repo_spec / "README.md").write_text(
            "# WithSpec\n\nFrom readme.", encoding="utf-8",
        )

        repo_readme = tmp_path / "repos" / "OnlyReadme.git"
        repo_readme.mkdir(parents=True)
        (repo_readme / "README.md").write_text(
            "# OnlyReadme\n\nReadme-only.", encoding="utf-8",
        )

        products = build_products(
            "Lab", ctx,
            git_folders={"WithSpec": str(repo_spec), "OnlyReadme": str(repo_readme)},
        )

        by_name = {p["name"]: p for p in products}
        assert by_name["WithSpec.git"]["spec"] == "spec/PRODUCT.md"
        assert by_name["WithSpec.git"]["description"] == "From spec."
        assert "spec" not in by_name["OnlyReadme.git"]
        assert by_name["OnlyReadme.git"]["description"] == "Readme-only."


# --- Rule B: <context>/spec/PRODUCT.md -------------------------------------


class TestRuleB:
    def test_rule_B_root_spec_makes_context_product(self, tmp_path: Path) -> None:
        ctx = tmp_path / "Lab"
        (ctx / "spec").mkdir(parents=True)
        (ctx / "spec" / "PRODUCT.md").write_text(
            "# Lab\n\nContext-as-product.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={})

        assert len(products) == 1
        p = products[0]
        assert p["name"] == "Lab"
        assert p["path"] == "@Lab"
        assert p["spec"] == "spec/PRODUCT.md"
        assert p["description"] == "Context-as-product."


# --- Rule C: subfolder with spec/PRODUCT.md (no context.json) --------------


class TestRuleC:
    def test_rule_C_subfolder_spec_makes_product(self, tmp_path: Path) -> None:
        ctx = tmp_path / "Lab"
        sub = ctx / "MyProduct"
        (sub / "spec").mkdir(parents=True)
        (sub / "spec" / "PRODUCT.md").write_text(
            "# MyProduct\n\nA sub-product.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={})

        assert len(products) == 1
        p = products[0]
        assert p["name"] == "MyProduct"
        assert p["path"] == "@Lab/MyProduct"
        assert p["spec"] == "spec/PRODUCT.md"
        assert p["description"] == "A sub-product."

    def test_rule_C_skips_subfolder_with_context_json(self, tmp_path: Path) -> None:
        """A subfolder with its own `context.json` is a child context — its
        products belong in its own tree, not the parent's."""
        ctx = tmp_path / "Lab"
        sub = ctx / "ChildCtx"
        (sub / "spec").mkdir(parents=True)
        (sub / "spec" / "PRODUCT.md").write_text(
            "# ChildCtx\n\nWould be a product if not a child context.",
            encoding="utf-8",
        )
        # Sub HAS its own manifest → must be skipped by rule C.
        (sub / "context.json").write_text(
            '{"version": 3, "name": "ChildCtx"}', encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={})

        assert products == []


# --- Rule D: README fallback -----------------------------------------------


class TestRuleD:
    def test_rule_D_readme_fallback_when_no_others(self, tmp_path: Path) -> None:
        ctx = tmp_path / "Lab"
        ctx.mkdir()
        (ctx / "README.md").write_text(
            "# Lab\n\nReadme-only context.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={})

        assert len(products) == 1
        p = products[0]
        assert p["name"] == "Lab"
        assert p["path"] == "@Lab"
        assert "spec" not in p
        assert p["description"] == "Readme-only context."

    def test_rule_D_does_not_fire_when_A_present(self, tmp_path: Path) -> None:
        """If A found any product, D doesn't fire even if README exists."""
        ctx = tmp_path / "Lab"
        ctx.mkdir()
        (ctx / "README.md").write_text(
            "# Lab\n\nThis README should be ignored.", encoding="utf-8",
        )
        repo = tmp_path / "repos" / "OnlyOne.git"
        repo.mkdir(parents=True)

        products = build_products(
            "Lab", ctx,
            git_folders={"OnlyOne": str(repo)},
        )

        assert [p["name"] for p in products] == ["OnlyOne.git"]


# --- Component path priorities (§2.3) --------------------------------------


class TestComponentPaths:
    def test_component_path_packages_spec_first(self, tmp_path: Path) -> None:
        """Path 1: <product>/packages/<comp>/spec/COMPONENT.md wins."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "packages" / "backend" / "spec").mkdir(parents=True)
        (repo / "packages" / "backend" / "spec" / "COMPONENT.md").write_text(
            "# Backend\n\nPath 1 spec.", encoding="utf-8",
        )

        products = build_products(
            "Lab", ctx,
            git_folders={"Duet": str(repo)},
        )
        comps = products[0]["components"]
        assert len(comps) == 1
        c = comps[0]
        assert c["name"] == "backend"
        assert c["path"] == "packages/backend"
        assert c["spec"] == "spec/COMPONENT.md"
        assert c["description"] == "Path 1 spec."

    def test_component_path_packages_readme_second(self, tmp_path: Path) -> None:
        """Path 2: <product>/packages/<comp>/README*.md wins over direct form."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "packages" / "backend").mkdir(parents=True)
        (repo / "packages" / "backend" / "README.md").write_text(
            "# Backend\n\nPath 2 readme.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        comps = products[0]["components"]
        c = next(c for c in comps if c["name"] == "backend")
        assert c["path"] == "packages/backend"
        assert "spec" not in c
        assert c["description"] == "Path 2 readme."

    def test_component_path_direct_spec_third(self, tmp_path: Path) -> None:
        """Path 3: <product>/<comp>/spec/COMPONENT.md."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Mono.git"
        (repo / "backend" / "spec").mkdir(parents=True)
        (repo / "backend" / "spec" / "COMPONENT.md").write_text(
            "# Backend\n\nPath 3 spec.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={"Mono": str(repo)})
        comps = products[0]["components"]
        c = next(c for c in comps if c["name"] == "backend")
        assert c["path"] == "backend"
        assert c["spec"] == "spec/COMPONENT.md"

    def test_component_path_direct_readme_last(self, tmp_path: Path) -> None:
        """Path 4: <product>/<comp>/README*.md as fallback."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Mono.git"
        (repo / "backend").mkdir(parents=True)
        (repo / "backend" / "README.md").write_text(
            "# Backend\n\nPath 4 readme.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={"Mono": str(repo)})
        comps = products[0]["components"]
        c = next(c for c in comps if c["name"] == "backend")
        assert c["path"] == "backend"
        assert "spec" not in c
        assert c["description"] == "Path 4 readme."

    def test_component_not_found_no_marker(self, tmp_path: Path) -> None:
        """A subfolder with none of the four paths is not a component."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "weird-folder").mkdir(parents=True)
        # No spec, no README — should not register

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        assert products[0]["components"] == []

    def test_depth_is_one_no_recursion(self, tmp_path: Path) -> None:
        """`<product>/<comp>/<subcomp>/README.md` — subcomp is ignored."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "comp" / "subcomp").mkdir(parents=True)
        (repo / "comp" / "subcomp" / "README.md").write_text(
            "# Subcomp", encoding="utf-8",
        )
        # `comp` itself has no marker → not a component

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        names = {c["name"] for c in products[0]["components"]}
        assert "subcomp" not in names


# --- Skip-list (§2.4) ------------------------------------------------------


class TestSkipList:
    def test_skip_list_blocks_workflow_folders(self, tmp_path: Path) -> None:
        # macOS filesystems are case-insensitive — `archive` and `ARCHIVE` are
        # the same folder. Test each via separate fresh trees.
        for workflow_name in ("drafts", "work", "archive"):
            ctx = tmp_path / workflow_name / "Lab"
            repo = tmp_path / workflow_name / "repos" / "Duet.git"
            d = repo / workflow_name
            d.mkdir(parents=True)
            (d / "README.md").write_text(
                f"# {workflow_name}\n\nShould be skipped.", encoding="utf-8",
            )

            products = build_products(
                "Lab", ctx, git_folders={"Duet": str(repo)},
            )
            names = {c["name"] for c in products[0]["components"]}
            assert workflow_name not in names

    def test_skip_list_blocks_build_artifacts(self, tmp_path: Path) -> None:
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        for art in ("node_modules", "dist", "__pycache__", ".venv"):
            d = repo / art
            d.mkdir(parents=True)
            (d / "README.md").write_text(f"# {art}", encoding="utf-8")

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        names = {c["name"] for c in products[0]["components"]}
        assert names.isdisjoint({"node_modules", "dist", "__pycache__", ".venv"})

    def test_skip_list_blocks_hidden(self, tmp_path: Path) -> None:
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / ".hidden").mkdir(parents=True)
        (repo / ".hidden" / "README.md").write_text("# hidden", encoding="utf-8")

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        names = {c["name"] for c in products[0]["components"]}
        assert ".hidden" not in names

    def test_skip_list_at_context_level(self, tmp_path: Path) -> None:
        """Skip-list also applies at the context level (when finding sub-products)."""
        ctx = tmp_path / "Lab"
        # `work` exists with spec/PRODUCT.md but is a workflow folder → skip
        work = ctx / "work"
        (work / "spec").mkdir(parents=True)
        (work / "spec" / "PRODUCT.md").write_text("# work", encoding="utf-8")

        products = build_products("Lab", ctx, git_folders={})
        assert products == []


# --- README priority (§2.5) ------------------------------------------------


class TestReadmePriority:
    def test_readme_priority_exact_first(self, tmp_path: Path) -> None:
        """Exact `README.md` wins over README.*.md siblings."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "backend").mkdir(parents=True)
        (repo / "backend" / "README.md").write_text(
            "# Backend\n\nExact wins.", encoding="utf-8",
        )
        (repo / "backend" / "README.draft.md").write_text(
            "# Draft\n\nShould not be picked.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        comps = products[0]["components"]
        c = next(c for c in comps if c["name"] == "backend")
        assert c["description"] == "Exact wins."

    def test_readme_priority_alphabetical_when_no_exact(self, tmp_path: Path) -> None:
        """No `README.md`: alphabetically first `README*.md` wins."""
        ctx = tmp_path / "Lab"
        repo = tmp_path / "repos" / "Duet.git"
        (repo / "backend").mkdir(parents=True)
        # zeta < alpha lexicographically? "README.alpha.md" < "README.zeta.md"
        (repo / "backend" / "README.zeta.md").write_text(
            "# Zeta\n\nZeta readme.", encoding="utf-8",
        )
        (repo / "backend" / "README.alpha.md").write_text(
            "# Alpha\n\nAlpha readme.", encoding="utf-8",
        )

        products = build_products("Lab", ctx, git_folders={"Duet": str(repo)})
        comps = products[0]["components"]
        c = next(c for c in comps if c["name"] == "backend")
        assert c["description"] == "Alpha readme."


# --- Misc ------------------------------------------------------------------


class TestSkipListConstant:
    def test_skip_list_contents(self) -> None:
        """Skip-list contents match design-doc §2.4."""
        expected = {
            "drafts", "work", "archive", "ARCHIVE",
            "bin", "out", "dist", "build",
            "node_modules", "target", "__pycache__", ".venv", "venv",
            "src", "spec", "docs", "tests", "test", "examples",
        }
        assert expected.issubset(SKIP_FOLDERS)


class TestCombinedRules:
    def test_A_plus_B_coexist(self, tmp_path: Path) -> None:
        """`git_repos` (A) and `<context>/spec/PRODUCT.md` (B) can coexist."""
        ctx = tmp_path / "Lab"
        (ctx / "spec").mkdir(parents=True)
        (ctx / "spec" / "PRODUCT.md").write_text(
            "# Lab\n\nContext-also-a-product.", encoding="utf-8",
        )
        repo = tmp_path / "repos" / "Tool.git"
        repo.mkdir(parents=True)

        products = build_products("Lab", ctx, git_folders={"Tool": str(repo)})
        names = [p["name"] for p in products]
        # A first (manifest order), then B
        assert names == ["Tool.git", "Lab"]

    def test_C_alphabetical_order(self, tmp_path: Path) -> None:
        """Rule C iterates subfolders in alphabetical order."""
        ctx = tmp_path / "Lab"
        for name in ("zeta", "alpha", "mango"):
            d = ctx / name / "spec"
            d.mkdir(parents=True)
            (d / "PRODUCT.md").write_text(f"# {name}", encoding="utf-8")

        products = build_products("Lab", ctx, git_folders={})
        assert [p["name"] for p in products] == ["alpha", "mango", "zeta"]
