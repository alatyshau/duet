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
        # Simple creation
        entity = EntityFactory.business("MyBusiness", "/path")

        # With custom fields
        entity = EntityFactory.product("MyProduct", "/path", parent_id=1)

        # Insert directly into db
        entity_id = EntityFactory.insert_business(db, "MyBusiness", "/path")
    """

    # Default icons for each entity type
    ICONS = {
        "business": "🏢",
        "stream": "🌊",
        "product": "📦",
        "component": "📁",
    }

    @classmethod
    def business(
        cls,
        name: str = "Business",
        drive_path: str = "/business",
        **kwargs
    ) -> Entity:
        """Create a business entity."""
        return Entity(
            id=kwargs.pop("id", None),
            type="business",
            name=name,
            icon=kwargs.pop("icon", cls.ICONS["business"]),
            drive_path=drive_path,
            **kwargs
        )

    @classmethod
    def stream(
        cls,
        name: str = "Stream",
        drive_path: str = "/stream",
        **kwargs
    ) -> Entity:
        """Create a stream entity."""
        return Entity(
            id=kwargs.pop("id", None),
            type="stream",
            name=name,
            icon=kwargs.pop("icon", cls.ICONS["stream"]),
            drive_path=drive_path,
            **kwargs
        )

    @classmethod
    def product(
        cls,
        name: str = "Product",
        drive_path: str = "/product",
        **kwargs
    ) -> Entity:
        """Create a product entity."""
        return Entity(
            id=kwargs.pop("id", None),
            type="product",
            name=name,
            icon=kwargs.pop("icon", cls.ICONS["product"]),
            drive_path=drive_path,
            **kwargs
        )

    @classmethod
    def component(
        cls,
        name: str = "Component",
        drive_path: str = "/component",
        **kwargs
    ) -> Entity:
        """Create a component entity."""
        return Entity(
            id=kwargs.pop("id", None),
            type="component",
            name=name,
            icon=kwargs.pop("icon", cls.ICONS["component"]),
            drive_path=drive_path,
            **kwargs
        )

    # Convenience methods for direct insert

    @classmethod
    def insert_business(cls, db, name: str = "Business", drive_path: str = "/business", **kwargs) -> int:
        """Create and insert a business entity, return its ID."""
        return db.insert_entity(cls.business(name, drive_path, **kwargs))

    @classmethod
    def insert_stream(cls, db, name: str = "Stream", drive_path: str = "/stream", **kwargs) -> int:
        """Create and insert a stream entity, return its ID."""
        return db.insert_entity(cls.stream(name, drive_path, **kwargs))

    @classmethod
    def insert_product(cls, db, name: str = "Product", drive_path: str = "/product", **kwargs) -> int:
        """Create and insert a product entity, return its ID."""
        return db.insert_entity(cls.product(name, drive_path, **kwargs))

    @classmethod
    def insert_hierarchy(cls, db, base_path: str = "/repos") -> dict[str, int]:
        """Create a standard hierarchy: business -> stream -> product.

        Returns dict with entity IDs: {"business": 1, "stream": 2, "product": 3}
        """
        biz_path = f"{base_path}/business"
        stream_path = f"{biz_path}/stream"
        product_path = f"{stream_path}/product"

        biz_id = cls.insert_business(db, "Business", biz_path)
        stream_id = cls.insert_stream(db, "Stream", stream_path, parent_id=biz_id)
        product_id = cls.insert_product(db, "Product", product_path, parent_id=stream_id)

        return {
            "business": biz_id,
            "stream": stream_id,
            "product": product_id,
        }
