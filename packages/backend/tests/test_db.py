"""Tests for db.py - SQLite database manager."""

import pytest

from tests.fixtures import EntityFactory


class TestDatabaseManager:
    """Tests for DatabaseManager class."""

    def test_init_creates_schema(self, db) -> None:
        """Database initialization creates the entities table."""
        # Table should exist - query should not raise
        entities = db.get_all_entities()
        assert entities == []

    def test_insert_entity(self, db) -> None:
        """Can insert an entity and get its ID."""
        entity_id = EntityFactory.insert_business(db, "Test Business", "/path/to/business")
        assert entity_id == 1

    def test_insert_entity_idempotent(self, db) -> None:
        """Inserting same entity twice returns same ID."""
        entity = EntityFactory.business("Test Business", "/path/to/business")
        id1 = db.insert_entity(entity)
        id2 = db.insert_entity(entity)
        assert id1 == id2

    def test_get_entities_by_parent(self, db) -> None:
        """Can filter entities by parent_id."""
        parent_id = EntityFactory.insert_business(db, "Parent", "/parent")
        EntityFactory.insert_stream(db, "Child", "/parent/child", parent_id=parent_id)

        # Get root entities
        roots = db.get_entities(parent_id=None)
        assert len(roots) == 1
        assert roots[0].name == "Parent"

        # Get children
        children = db.get_entities(parent_id=parent_id)
        assert len(children) == 1
        assert children[0].name == "Child"

    def test_find_by_name(self, db) -> None:
        """Can find entity by globally unique name."""
        EntityFactory.insert_product(db, "UniqueProduct", "/path/product")

        found = db.find_by_name("UniqueProduct")
        assert found is not None
        assert found.name == "UniqueProduct"
        assert found.type == "product"

        not_found = db.find_by_name("NonExistent")
        assert not_found is None

    def test_name_exists(self, db) -> None:
        """Can check if name exists."""
        EntityFactory.insert_business(db, "ExistingName", "/path")

        assert db.name_exists("ExistingName") is True
        assert db.name_exists("NonExistent") is False

    def test_update_entity_name(self, db) -> None:
        """Can update entity name."""
        entity_id = EntityFactory.insert_business(db, "OldName", "/path")

        db.update_entity_name(entity_id, "NewName")

        updated = db.get_entity(entity_id)
        assert updated is not None
        assert updated.name == "NewName"

    def test_clear(self, db) -> None:
        """Can clear all entities."""
        EntityFactory.insert_business(db, "ToBeDeleted", "/path")
        assert len(db.get_all_entities()) == 1

        db.clear()
        assert len(db.get_all_entities()) == 0

    def test_find_closest_entity(self, db) -> None:
        """Can find deepest entity containing a path."""
        biz_id = EntityFactory.insert_business(db, "Business", "/repos/business")
        EntityFactory.insert_product(db, "Product", "/repos/business/product", parent_id=biz_id)

        # Find closest for deep path
        found = db.find_closest_entity("/repos/business/product/src/file.py")
        assert found is not None
        assert found.name == "Product"

        # Find closest for business path
        found = db.find_closest_entity("/repos/business/other/file.py")
        assert found is not None
        assert found.name == "Business"

        # Not found
        found = db.find_closest_entity("/other/path")
        assert found is None

    def test_get_entity_chain(self, db) -> None:
        """Can get chain from root to entity."""
        ids = EntityFactory.insert_hierarchy(db, "/business")

        # Get chain
        chain = db.get_entity_chain(ids["product"])
        assert len(chain) == 3
        assert chain[0].name == "Business"
        assert chain[1].name == "Stream"
        assert chain[2].name == "Product"

    def test_has_children(self, db) -> None:
        """Can check if entity has children."""
        parent_id = EntityFactory.insert_business(db, "Parent", "/parent")

        # No children yet
        assert db.has_children(parent_id) is False

        # Add child
        EntityFactory.insert_stream(db, "Child", "/parent/child", parent_id=parent_id)

        assert db.has_children(parent_id) is True

    def test_get_streams_includes_active_projects(self, db) -> None:
        """get_streams() includes active projects under business/stream."""
        biz_id = EntityFactory.insert_business(db, "Business", "/biz")
        stream_id = EntityFactory.insert_stream(db, "Stream", "/biz/stream", parent_id=biz_id)
        EntityFactory.insert_project(db, "ActiveProj", "/biz/stream/projects/p1", parent_id=stream_id, status="active")

        streams = db.get_streams()
        types = {e.type for e in streams}
        assert "project" in types

        project = next(e for e in streams if e.type == "project")
        assert project.name == "ActiveProj"
        assert project.status == "active"

    def test_get_streams_excludes_inactive_projects(self, db) -> None:
        """get_streams() excludes projects with status != 'active'."""
        biz_id = EntityFactory.insert_business(db, "Business", "/biz")
        EntityFactory.insert_project(db, "NoStatus", "/biz/projects/p1", parent_id=biz_id)
        EntityFactory.insert_project(db, "Postponed", "/biz/projects/p2", parent_id=biz_id, status="postponed")
        EntityFactory.insert_project(db, "Archived", "/biz/projects/p3", parent_id=biz_id, status="archived")

        streams = db.get_streams()
        assert all(e.type != "project" for e in streams)

    def test_get_streams_excludes_product_projects(self, db) -> None:
        """get_streams() excludes active projects under products."""
        biz_id = EntityFactory.insert_business(db, "Business", "/biz")
        product_id = EntityFactory.insert_product(db, "Product", "/biz/product", parent_id=biz_id)
        EntityFactory.insert_project(db, "ProdProj", "/biz/product/projects/p1", parent_id=product_id, status="active")

        streams = db.get_streams()
        assert all(e.type != "project" for e in streams)

    def test_has_children_with_exclude(self, db) -> None:
        """Can check children excluding certain types."""
        parent_id = EntityFactory.insert_business(db, "Parent", "/parent")

        # Add project child
        EntityFactory.insert_project(db, "Project", "/parent/projects/proj", parent_id=parent_id)

        # Has children
        assert db.has_children(parent_id) is True
        # But not if excluding projects
        assert db.has_children(parent_id, exclude_types=["project"]) is False
