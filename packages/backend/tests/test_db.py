"""Tests for db.py - SQLite database manager."""

import pytest

from tests.fixtures import EntityFactory


class TestDatabaseManager:
    """Tests for DatabaseManager class."""

    def test_init_creates_schema(self, db) -> None:
        """Database initialization creates the entities table."""
        entities = db.get_all_entities()
        assert entities == []

    def test_insert_entity(self, db) -> None:
        """Can insert an entity and get its ID."""
        entity_id = EntityFactory.insert_context(db, "Root", "/path/to/root")
        assert entity_id == 1

    def test_insert_entity_idempotent(self, db) -> None:
        """Inserting same entity twice returns same ID."""
        entity = EntityFactory.context("Root", "/path/to/root")
        id1 = db.insert_entity(entity)
        id2 = db.insert_entity(entity)
        assert id1 == id2

    def test_get_entities_by_parent(self, db) -> None:
        """Can filter entities by parent_id."""
        parent_id = EntityFactory.insert_context(db, "Parent", "/parent")
        EntityFactory.insert_context(db, "Child", "/parent/child", parent_id=parent_id)

        roots = db.get_entities(parent_id=None)
        assert len(roots) == 1
        assert roots[0].name == "Parent"

        children = db.get_entities(parent_id=parent_id)
        assert len(children) == 1
        assert children[0].name == "Child"

    def test_find_by_name(self, db) -> None:
        """Can find entity by globally unique name."""
        EntityFactory.insert_context(db, "UniqueProduct", "/path/product",
                                      git_url="https://example.com/p.git")

        found = db.find_by_name("UniqueProduct")
        assert found is not None
        assert found.name == "UniqueProduct"
        assert found.type == "context"
        assert found.git_url == "https://example.com/p.git"

        not_found = db.find_by_name("NonExistent")
        assert not_found is None

    def test_name_exists(self, db) -> None:
        EntityFactory.insert_context(db, "ExistingName", "/path")

        assert db.name_exists("ExistingName") is True
        assert db.name_exists("NonExistent") is False

    def test_update_entity_name(self, db) -> None:
        entity_id = EntityFactory.insert_context(db, "OldName", "/path")

        db.update_entity_name(entity_id, "NewName")

        updated = db.get_entity(entity_id)
        assert updated is not None
        assert updated.name == "NewName"

    def test_clear(self, db) -> None:
        EntityFactory.insert_context(db, "ToBeDeleted", "/path")
        assert len(db.get_all_entities()) == 1

        db.clear()
        assert len(db.get_all_entities()) == 0

    def test_find_closest_entity(self, db) -> None:
        """Can find deepest entity containing a path."""
        root_id = EntityFactory.insert_context(db, "Root", "/repos/root")
        EntityFactory.insert_context(
            db, "Product", "/repos/root/product",
            parent_id=root_id, git_url="https://example.com/p.git",
        )

        found = db.find_closest_entity("/repos/root/product/src/file.py")
        assert found is not None
        assert found.name == "Product"

        found = db.find_closest_entity("/repos/root/other/file.py")
        assert found is not None
        assert found.name == "Root"

        found = db.find_closest_entity("/other/path")
        assert found is None

    def test_get_entity_chain(self, db) -> None:
        """Can get chain from root to entity."""
        ids = EntityFactory.insert_hierarchy(db, "/base")

        chain = db.get_entity_chain(ids["product"])
        assert len(chain) == 3
        assert chain[0].name == "Root"
        assert chain[1].name == "Mid"
        assert chain[2].name == "Product"

    def test_has_children(self, db) -> None:
        parent_id = EntityFactory.insert_context(db, "Parent", "/parent")

        assert db.has_children(parent_id) is False

        EntityFactory.insert_context(db, "Child", "/parent/child", parent_id=parent_id)

        assert db.has_children(parent_id) is True

    def test_get_contexts_returns_only_contexts(self, db) -> None:
        """get_contexts() returns context entities, excludes product_repo and reference_repo."""
        from db import Entity

        root_id = EntityFactory.insert_context(db, "Root", "/root")
        product_id = EntityFactory.insert_context(
            db, "Product", "/root/product",
            parent_id=root_id, git_url="https://example.com/p.git",
        )
        # Insert a product_repo entity directly
        db.insert_entity(Entity(
            id=None, type="product_repo", name="Product.git",
            icon="📂", drive_path="Product.git",
            parent_id=product_id, git_url="https://example.com/p.git",
        ))

        contexts = db.get_contexts()
        types = {e.type for e in contexts}
        assert types == {"context"}
        assert {e.name for e in contexts} == {"Root", "Product"}

    def test_find_meta_context(self, db) -> None:
        """find_meta_context returns the entity with meta=True."""
        EntityFactory.insert_context(db, "Plain", "/plain")
        EntityFactory.insert_context(db, "Meta", "/meta", meta=True)

        found = db.find_meta_context()
        assert found is not None
        assert found.name == "Meta"
        assert found.meta is True

    def test_find_meta_context_returns_none(self, db) -> None:
        EntityFactory.insert_context(db, "Plain", "/plain")
        assert db.find_meta_context() is None

    def test_find_closest_entity_segment_boundary(self, db) -> None:
        """Sibling with shared prefix must NOT match.

        Regression: `instr(path, drive_path) = 1` would resolve
        `Root/AlphaBeta/file` to `Root/Alpha` when `Root/AlphaBeta` is
        not registered. Fix anchors comparison on `/` boundary.
        """
        root_id = EntityFactory.insert_context(db, "Root", "Root")
        EntityFactory.insert_context(db, "Alpha", "Root/Alpha", parent_id=root_id)
        # Note: Root/AlphaBeta is NOT registered as entity.

        # Path inside Root/AlphaBeta must resolve to the closest registered
        # ancestor — Root, not Root/Alpha (which only shares a string prefix).
        found = db.find_closest_entity("Root/AlphaBeta/file.md")
        assert found is not None
        assert found.name == "Root"

        # Sanity: an exact subpath of Root/Alpha resolves to Root/Alpha.
        found_alpha = db.find_closest_entity("Root/Alpha/sub.md")
        assert found_alpha is not None
        assert found_alpha.name == "Alpha"
