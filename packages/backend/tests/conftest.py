"""Shared fixtures for backend tests.

This module provides centralized fixtures for all tests:
- duet_data: DuetData directory with config
- db: DatabaseManager instance
- client: Async HTTP test client

All fixtures use tmp_path for isolation between tests.
"""

import json
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from db import DatabaseManager
from mcp_handler import init_services
from server import create_app
from services.entities import EntitiesService
from services.workspace import WorkspaceService

from tests.fixtures import DuetDataBuilder, EntityFactory


# Re-export fixtures for convenience
__all__ = ["EntityFactory", "DuetDataBuilder"]


@pytest.fixture
def duet_data(tmp_path: Path) -> Path:
    """Create DuetData directory structure with config.

    Creates:
    - ai-kit/ directory
    - data/ directory
    - config.json with test configuration

    Returns path to DuetData root.
    """
    builder = DuetDataBuilder(tmp_path)
    return builder.build()


@pytest.fixture(autouse=True)
def init_config(duet_data: Path) -> Path:
    """Initialize config with DuetData path.

    This fixture runs automatically for all tests.
    Depends on duet_data fixture.
    """
    config.init(duet_data)
    return duet_data


@pytest.fixture
def db(duet_data: Path) -> DatabaseManager:
    """Create DatabaseManager instance with temporary database.

    Database is created in duet_data/data/test.db
    """
    db_path = duet_data / "data" / "test.db"
    manager = DatabaseManager(db_path)
    manager.init()
    return manager


@pytest.fixture
def db_with_services(db: DatabaseManager) -> DatabaseManager:
    """Create DatabaseManager with initialized services (DI).

    Use this fixture when testing API endpoints that need services.
    """
    import time

    workspace_service = WorkspaceService(db)
    entities_service = EntitiesService(db)
    init_services(workspace_service, entities_service, time.time())
    return db


@pytest_asyncio.fixture
async def client(db_with_services: DatabaseManager) -> AsyncClient:
    """Create async HTTP test client.

    Uses ASGI transport for in-process testing (no network).
    """
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def entity_factory() -> type[EntityFactory]:
    """Return EntityFactory class for creating test entities.

    Usage in tests:
        def test_something(entity_factory, db):
            entity = entity_factory.business("MyBusiness", "/path")
            db.insert_entity(entity)
    """
    return EntityFactory


@pytest.fixture
def duet_data_builder(tmp_path: Path) -> DuetDataBuilder:
    """Return DuetDataBuilder for custom DuetData setup.

    Usage in tests:
        def test_something(duet_data_builder):
            builder = duet_data_builder
            builder.with_version("2.0.0")
            builder.add_business("MyBusiness")
            path = builder.build()
    """
    return DuetDataBuilder(tmp_path)
