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
        response = await client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert data["version"] == "test"
        assert "uptime_seconds" in data


@pytest.mark.asyncio
class TestTimestampEndpoint:
    """Tests for /timestamp endpoint."""

    async def test_timestamp_format(self, client: AsyncClient) -> None:
        response = await client.get("/timestamp")
        assert response.status_code == 200

        data = response.json()
        ts = data["timestamp"]

        assert len(ts) >= 14
        assert "_" in ts


@pytest.mark.asyncio
class TestDuetDataPathEndpoint:
    """Tests for /duet-data-path endpoint."""

    async def test_returns_path(self, client: AsyncClient, duet_data: Path) -> None:
        response = await client.get("/duet-data-path")
        assert response.status_code == 200

        data = response.json()
        assert "path" in data
        assert data["path"] == str(duet_data)


@pytest.mark.asyncio
class TestContextsEndpoint:
    """Tests for /contexts endpoint."""

    async def test_empty_contexts(self, client: AsyncClient) -> None:
        response = await client.get("/contexts")
        assert response.status_code == 200

        data = response.json()
        assert data["contexts"] == []

    async def test_returns_contexts(self, client: AsyncClient, db) -> None:
        db.insert_entity(EntityFactory.context("Root", "/root"))
        db.insert_entity(EntityFactory.context(
            "Product", "/root/product",
            git_url="https://example.com/p.git",
        ))

        response = await client.get("/contexts")
        assert response.status_code == 200

        data = response.json()
        assert len(data["contexts"]) == 2
        for entry in data["contexts"]:
            assert entry["type"] == "context"
            assert "meta" in entry

    async def test_contexts_exposes_reference_repos_from_manifest(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        """Entities with reference_repos in manifest carry them in /contexts response."""
        builder = duet_data_builder
        builder.add_root_context("Root")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        from tests.fixtures import ManifestBuilder
        ManifestBuilder.context(
            root_path, "Root",
            reference_repos={"cookbook": "https://github.com/anthropics/cookbook.git"},
        )

        from scanner import Scanner
        Scanner(db, repos_path=builder.get_repos_path()).scan()

        response = await client.get("/contexts")
        assert response.status_code == 200

        contexts = response.json()["contexts"]
        ctx = next(c for c in contexts if c["name"] == "Root")
        assert ctx["reference_repos"] == {
            "cookbook": "https://github.com/anthropics/cookbook.git"
        }

    async def test_contexts_reference_repos_null_when_absent(
        self, client: AsyncClient, db
    ) -> None:
        db.insert_entity(EntityFactory.context("Root", "/root"))
        response = await client.get("/contexts")

        contexts = response.json()["contexts"]
        assert contexts[0]["reference_repos"] is None


@pytest.mark.asyncio
class TestOrientationEndpoint:
    """Tests for /orientation endpoint."""

    async def test_returns_base_info(self, client: AsyncClient, duet_data: Path) -> None:
        response = await client.post("/orientation", json={"workspace_paths": []})
        assert response.status_code == 200

        data = response.json()
        assert data["workspace"]["kind"] == "unknown"
        assert data["workspace"]["reason"] == "no_workspace_path"
        assert data["duet_paths"]["duetDataPath"] == str(duet_data)

    async def test_returns_chain(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        """Returns chain for workspace path under repos."""
        builder = duet_data_builder
        builder.add_root_context("Root")
        builder.add_repo("Product", components=["extension"])
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "Mid"
        mid_path.mkdir()
        from tests.fixtures import ManifestBuilder
        ManifestBuilder.context(mid_path, "Mid")

        product_path = mid_path / "Product"
        product_path.mkdir()
        ManifestBuilder.context(product_path, "Product", git_url="https://...")

        from scanner import Scanner
        Scanner(db, repos_path=builder.get_repos_path()).scan()

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
        assert data["workspace"]["kind"] == "context"
        chain = data["context"]["chain"]
        assert len(chain) == 3
        assert [c["name"] for c in chain] == ["Root", "Mid", "Product"]
        assert all(c["type"] == "context" for c in chain)


@pytest.mark.asyncio
class TestScanEndpoint:
    """Tests for /scan endpoint."""

    async def test_scan_returns_stats(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: []
        )

        response = await client.post("/scan")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "completed"
        assert "entities_count" in data
        assert "duration_ms" in data

    async def test_scan_debounce(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(
            "scanner.get_root_context_folders",
            lambda: []
        )

        response1 = await client.post("/scan")
        assert response1.status_code == 200
        assert response1.json()["status"] == "completed"

        response2 = await client.post("/scan")
        assert response2.status_code == 200
        data = response2.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "recent_scan"


class TestResolveAbsolutePath:
    """Unit tests for EntitiesService._resolve_absolute_path()."""

    def test_drive_entity_root(self) -> None:
        path_lookup = {
            "root_context_folders": {"MyRoot": Path("/drive/MyRoot")},
            "repos_path": None,
        }
        result = EntitiesService._resolve_absolute_path("MyRoot", path_lookup)
        assert result == str(Path("/drive/MyRoot"))

    def test_drive_entity_nested(self) -> None:
        path_lookup = {
            "root_context_folders": {"MyRoot": Path("/drive/MyRoot")},
            "repos_path": None,
        }
        result = EntitiesService._resolve_absolute_path(
            "MyRoot/Streams/TechStream", path_lookup
        )
        assert result == str(Path("/drive/MyRoot/Streams/TechStream"))

    def test_repos_subpath(self) -> None:
        path_lookup = {
            "root_context_folders": {"MyRoot": Path("/drive/MyRoot")},
            "repos_path": Path("/data/repos"),
        }
        result = EntitiesService._resolve_absolute_path(
            "Product.git/projects/my_project", path_lookup
        )
        assert result == str(Path("/data/repos/Product.git/projects/my_project"))

    def test_none_drive_path(self) -> None:
        path_lookup = {
            "root_context_folders": {},
            "repos_path": None,
        }
        assert EntitiesService._resolve_absolute_path(None, path_lookup) is None
        assert EntitiesService._resolve_absolute_path("", path_lookup) is None

    def test_no_match_no_repos(self) -> None:
        path_lookup = {
            "root_context_folders": {"Other": Path("/drive/Other")},
            "repos_path": None,
        }
        assert EntitiesService._resolve_absolute_path("Unknown/path", path_lookup) is None


@pytest.mark.asyncio
class TestAbsolutePathIntegration:
    """Integration: /contexts returns absolute_path."""

    async def test_contexts_absolute_path(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        from scanner import Scanner
        from mcp_handler import init_services
        from services.workspace import WorkspaceService

        builder = duet_data_builder
        builder.add_root_context("TestRoot")
        builder.build(monkeypatch)

        root_path = builder.get_root_context_path(0)
        mid_path = root_path / "MyMid"
        mid_path.mkdir()
        from tests.fixtures import ManifestBuilder
        ManifestBuilder.context(mid_path, "MyMid")

        Scanner(db).scan()

        workspace_service = WorkspaceService(db)
        entities_service = EntitiesService(db)
        init_services(workspace_service, entities_service, time.time())

        response = await client.get("/contexts")
        assert response.status_code == 200

        contexts = response.json()["contexts"]
        assert len(contexts) == 2

        root = next(c for c in contexts if c["name"] == "TestRoot")
        mid = next(c for c in contexts if c["name"] == "MyMid")

        assert root["absolute_path"] == str(root_path)
        assert mid["absolute_path"] == str(mid_path)


@pytest.mark.asyncio
class TestDeployInstructionsEndpoint:
    """Tests for /deploy-instructions endpoint."""

    async def test_bad_json_returns_400(self, client: AsyncClient) -> None:
        response = await client.post(
            "/deploy-instructions", content="not json", headers={"content-type": "application/json"}
        )
        assert response.status_code == 400
        assert response.json()["code"] == "BAD_REQUEST"

    async def test_non_list_paths_returns_400(self, client: AsyncClient) -> None:
        response = await client.post("/deploy-instructions", json={"workspace_paths": "x"})
        assert response.status_code == 400
        assert response.json()["code"] == "BAD_REQUEST"

    async def test_unknown_context(self, client: AsyncClient) -> None:
        response = await client.post("/deploy-instructions", json={"workspace_paths": []})
        assert response.status_code == 200
        assert response.json() == {"status": "unknown", "reason": "no_owning_context"}

    async def test_deploys_resolved_context(
        self, client: AsyncClient, db, duet_data_builder, monkeypatch
    ) -> None:
        from scanner import Scanner
        from services.workspace import WorkspaceService
        from mcp_handler import init_services
        from tests.fixtures import ManifestBuilder

        builder = duet_data_builder
        builder.add_root_context("Root")
        builder.build(monkeypatch)
        root_path = builder.get_root_context_path(0)
        ctx_path = root_path / "Proj"
        ctx_path.mkdir()
        skill = ctx_path / "_src" / "myskill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("# myskill", encoding="utf-8")
        ManifestBuilder.context(ctx_path, "Proj", skills=["@Proj/_src/myskill"], instructions=[])
        Scanner(db, repos_path=builder.get_repos_path()).scan()
        init_services(WorkspaceService(db), EntitiesService(db), time.time())

        response = await client.post(
            "/deploy-instructions", json={"workspace_paths": [str(ctx_path)]}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "myskill" in data["deployed"]["skills_deployed"]
        assert (ctx_path / ".claude" / "skills" / "myskill" / "SKILL.md").is_file()
        assert (ctx_path / "CLAUDE.md").is_file()
