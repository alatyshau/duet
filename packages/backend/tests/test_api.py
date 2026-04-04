"""Tests for server.py - HTTP API endpoints."""

import time
from pathlib import Path

import pytest
from httpx import AsyncClient

from services.entities import EntitiesService
from tests.fixtures import EntityFactory


@pytest.mark.asyncio
class TestHealthEndpoint:
    """Tests for /health endpoint."""

    async def test_health_returns_ok(self, client: AsyncClient) -> None:
        """Health endpoint returns status ok."""
        response = await client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert data["version"] == "test"  # from DuetDataBuilder.DEFAULT_CONFIG
        assert "uptime_seconds" in data


@pytest.mark.asyncio
class TestTimestampEndpoint:
    """Tests for /timestamp endpoint."""

    async def test_timestamp_format(self, client: AsyncClient) -> None:
        """Timestamp endpoint returns properly formatted timestamp."""
        response = await client.get("/timestamp")
        assert response.status_code == 200

        data = response.json()
        ts = data["timestamp"]

        # Format: YYMMDD_HHMMSS + timezone suffix
        assert len(ts) >= 14  # minimum: 260131_120000Z
        assert "_" in ts


@pytest.mark.asyncio
class TestDuetDataPathEndpoint:
    """Tests for /duet-data-path endpoint."""

    async def test_returns_path(self, client: AsyncClient, duet_data: Path) -> None:
        """Returns path to DuetData."""
        response = await client.get("/duet-data-path")
        assert response.status_code == 200

        data = response.json()
        assert "path" in data
        assert data["path"] == str(duet_data)


@pytest.mark.asyncio
class TestStreamsEndpoint:
    """Tests for /streams endpoint."""

    async def test_empty_streams(self, client: AsyncClient) -> None:
        """Returns empty list when no entities."""
        response = await client.get("/streams")
        assert response.status_code == 200

        data = response.json()
        assert data["streams"] == []

    async def test_returns_streams(self, client: AsyncClient, db) -> None:
        """Returns list of streams (business/stream/product)."""
        db.insert_entity(EntityFactory.business("Business", "/business"))
        db.insert_entity(EntityFactory.product("Product", "/product"))

        response = await client.get("/streams")
        assert response.status_code == 200

        data = response.json()
        assert len(data["streams"]) == 2

    async def test_excludes_projects_without_active_status(self, client: AsyncClient, db) -> None:
        """Excludes projects without status='active' from streams."""
        parent_id = EntityFactory.insert_business(db, "Business", "/business")
        EntityFactory.insert_project(db, "Project", "/business/project", parent_id=parent_id)

        response = await client.get("/streams")
        assert response.status_code == 200

        data = response.json()
        assert len(data["streams"]) == 1
        assert data["streams"][0]["type"] == "business"

    async def test_includes_active_project(self, client: AsyncClient, db) -> None:
        """Includes active projects under business/stream in streams."""
        biz_id = EntityFactory.insert_business(db, "Business", "/business")
        stream_id = EntityFactory.insert_stream(db, "Stream", "/business/stream", parent_id=biz_id)
        EntityFactory.insert_project(db, "ActiveProj", "/business/stream/projects/p1", parent_id=stream_id, status="active")

        response = await client.get("/streams")
        assert response.status_code == 200

        data = response.json()
        types = {s["type"] for s in data["streams"]}
        assert "project" in types

        project = next(s for s in data["streams"] if s["type"] == "project")
        assert project["name"] == "ActiveProj"
        assert project["status"] == "active"

    async def test_excludes_postponed_project(self, client: AsyncClient, db) -> None:
        """Excludes postponed/undefined projects from streams."""
        biz_id = EntityFactory.insert_business(db, "Business", "/business")
        EntityFactory.insert_project(db, "NoStatus", "/business/projects/p1", parent_id=biz_id)
        EntityFactory.insert_project(db, "Postponed", "/business/projects/p2", parent_id=biz_id, status="postponed")

        response = await client.get("/streams")
        assert response.status_code == 200

        data = response.json()
        assert all(s["type"] != "project" for s in data["streams"])


@pytest.mark.asyncio
class TestOrientationEndpoint:
    """Tests for /orientation endpoint."""

    async def test_returns_base_info(self, client: AsyncClient, duet_data: Path) -> None:
        """Returns base orientation without path."""
        response = await client.post("/orientation", json={"workspace_paths": []})
        assert response.status_code == 200

        data = response.json()
        assert data["workspace"]["type"] == "unknown"
        assert data["workspace"]["reason"] == "no_workspace_path"
        assert data["duet_paths"]["duetDataPath"] == str(duet_data)

    async def test_returns_chain(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        """Returns entity chain for workspace path (via repos)."""
        builder = duet_data_builder
        builder.add_business("Business")
        builder.add_repo("Product", components=["extension"])
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "Stream"
        stream_path.mkdir()
        from tests.fixtures import ManifestBuilder
        ManifestBuilder.stream(stream_path, "Stream")

        product_path = stream_path / "Product"
        product_path.mkdir()
        ManifestBuilder.product(product_path, "Product", git_url="https://...")

        from scanner import Scanner
        scanner = Scanner(db, repos_path=builder.get_repos_path())
        scanner.scan()

        import time
        from services.workspace import WorkspaceService
        from services.entities import EntitiesService
        from mcp_handler import init_services
        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        repo_path = str(builder.get_repo_path("Product") / "packages" / "extension")
        response = await client.post("/orientation", json={"workspace_paths": [repo_path]})
        assert response.status_code == 200

        data = response.json()
        assert data["workspace"]["type"] != "unknown"
        chain = data["context"]["chain"]
        assert len(chain) == 3
        assert chain[0]["name"] == "Business"
        assert chain[0]["type"] == "business"
        assert chain[1]["name"] == "Stream"
        assert chain[1]["type"] == "stream"
        assert chain[2]["name"] == "Product"
        assert chain[2]["type"] == "product"


@pytest.mark.asyncio
class TestScanEndpoint:
    """Tests for /scan endpoint."""

    async def test_scan_returns_stats(self, client: AsyncClient, monkeypatch) -> None:
        """Scan endpoint returns statistics."""
        # Mock config to return empty business_folders
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: []
        )

        response = await client.post("/scan")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "completed"
        assert "entities_count" in data
        assert "duration_ms" in data

    async def test_scan_debounce(self, client: AsyncClient, monkeypatch) -> None:
        """Scan returns skipped if called within 5 seconds."""
        monkeypatch.setattr(
            "scanner.get_business_folders",
            lambda: []
        )

        # First scan
        response1 = await client.post("/scan")
        assert response1.status_code == 200
        assert response1.json()["status"] == "completed"

        # Immediate second scan should be skipped
        response2 = await client.post("/scan")
        assert response2.status_code == 200
        data = response2.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "recent_scan"


class TestResolveAbsolutePath:
    """Unit tests for EntitiesService._resolve_absolute_path()."""

    def test_drive_entity_root(self) -> None:
        """Resolves business folder root (drive_path = folder name only)."""
        path_lookup = {
            "business_folders": {"MyBiz": Path("/drive/MyBiz")},
            "repos_path": None,
        }
        result = EntitiesService._resolve_absolute_path("MyBiz", path_lookup)
        assert result == str(Path("/drive/MyBiz"))

    def test_drive_entity_nested(self) -> None:
        """Resolves nested drive entity (stream/product)."""
        path_lookup = {
            "business_folders": {"MyBiz": Path("/drive/MyBiz")},
            "repos_path": None,
        }
        result = EntitiesService._resolve_absolute_path(
            "MyBiz/Streams/TechStream", path_lookup
        )
        assert result == str(Path("/drive/MyBiz/Streams/TechStream"))

    def test_repos_project(self) -> None:
        """Resolves repos project (drive_path not matching any business folder)."""
        path_lookup = {
            "business_folders": {"MyBiz": Path("/drive/MyBiz")},
            "repos_path": Path("/data/repos"),
        }
        result = EntitiesService._resolve_absolute_path(
            "Product.git/projects/my_project", path_lookup
        )
        assert result == str(Path("/data/repos/Product.git/projects/my_project"))

    def test_none_drive_path(self) -> None:
        """Returns None for empty drive_path."""
        path_lookup = {
            "business_folders": {},
            "repos_path": None,
        }
        assert EntitiesService._resolve_absolute_path(None, path_lookup) is None
        assert EntitiesService._resolve_absolute_path("", path_lookup) is None

    def test_no_match_no_repos(self) -> None:
        """Returns None when no business folder matches and no repos_path."""
        path_lookup = {
            "business_folders": {"Other": Path("/drive/Other")},
            "repos_path": None,
        }
        assert EntitiesService._resolve_absolute_path("Unknown/path", path_lookup) is None


@pytest.mark.asyncio
class TestAbsolutePathIntegration:
    """Integration tests: /streams and /projects return absolute_path."""

    async def test_streams_absolute_path(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        """Streams response includes correct absolute_path for scanned entities."""
        from scanner import Scanner
        from mcp_handler import init_services
        from services.workspace import WorkspaceService

        # Build hierarchy: business → stream → product
        builder = duet_data_builder
        builder.add_business("TestBiz")
        duet_data = builder.build(monkeypatch)

        biz_path = builder.get_business_path(0)
        stream_path = biz_path / "MyStream"
        stream_path.mkdir()
        from tests.fixtures import ManifestBuilder
        ManifestBuilder.stream(stream_path, "MyStream")

        # Scan
        scanner = Scanner(db)
        scanner.scan()

        # Re-init services
        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        # Request streams
        response = await client.get("/streams")
        assert response.status_code == 200

        streams = response.json()["streams"]
        assert len(streams) == 2  # business + stream

        # Find business and stream
        biz = next(s for s in streams if s["type"] == "business")
        stream = next(s for s in streams if s["type"] == "stream")

        # Verify absolute_path resolves correctly
        assert biz["absolute_path"] == str(biz_path)
        assert stream["absolute_path"] == str(stream_path)

