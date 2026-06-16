"""Entity factory for tests.

Provides EntityFactory with methods to create Entity objects
with sensible defaults, reducing boilerplate in tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from db import Entity


class EntityFactory:
    """Factory for creating Entity objects with sensible defaults.

    Usage:
        # Plain context
        entity = EntityFactory.context("МетаЛаб", "/path")

        # Context with git_url (git-backed product lives in repo)
        entity = EntityFactory.context("Duet", "/path", git_url="https://...")

        # Meta-context (one per workspace)
        entity = EntityFactory.context("БАЗА", "/path", meta=True)

        # Insert directly into db
        entity_id = EntityFactory.insert_context(db, "МетаЛаб", "/path")
    """

    DEFAULT_ICON_CONTEXT = "📁"
    DEFAULT_ICON_GIT = "📦"
    DEFAULT_ICON_COMPONENT = "📁"

    @classmethod
    def context(
        cls,
        name: str = "Context",
        drive_path: str = "/context",
        **kwargs,
    ) -> Entity:
        """Create a context entity.

        Pass ``meta=True`` for the meta-context, ``git_url=...`` for a
        context whose product lives in a git repo.
        """
        icon_default = cls.DEFAULT_ICON_GIT if kwargs.get("git_url") else cls.DEFAULT_ICON_CONTEXT
        return Entity(
            id=kwargs.pop("id", None),
            type="context",
            name=name,
            icon=kwargs.pop("icon", icon_default),
            drive_path=drive_path,
            **kwargs,
        )

    @classmethod
    def component(
        cls,
        name: str = "Component",
        drive_path: str = "/component",
        **kwargs,
    ) -> Entity:
        """Create a component entity (used in tests that pre-populate DB)."""
        return Entity(
            id=kwargs.pop("id", None),
            type="context",
            name=name,
            icon=kwargs.pop("icon", cls.DEFAULT_ICON_COMPONENT),
            drive_path=drive_path,
            **kwargs,
        )

    @classmethod
    def insert_context(
        cls,
        db,
        name: str = "Context",
        drive_path: str = "/context",
        **kwargs,
    ) -> int:
        """Create and insert a context entity, return its ID."""
        return db.insert_entity(cls.context(name, drive_path, **kwargs))

    @classmethod
    def insert_hierarchy(cls, db, base_path: str = "/repos") -> dict[str, int]:
        """Create a standard 3-level context hierarchy.

        Top-level (root context) -> intermediate context -> context-with-git.

        Returns dict: {"root": id, "mid": id, "product": id}.
        """
        root_path = f"{base_path}/Root"
        mid_path = f"{root_path}/Mid"
        product_path = f"{mid_path}/Product"

        root_id = cls.insert_context(db, "Root", root_path)
        mid_id = cls.insert_context(db, "Mid", mid_path, parent_id=root_id)
        product_id = cls.insert_context(
            db,
            "Product",
            product_path,
            parent_id=mid_id,
            git_url="https://example.com/Product.git",
        )

        return {
            "root": root_id,
            "mid": mid_id,
            "product": product_id,
        }
