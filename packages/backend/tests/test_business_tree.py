"""Business discovery is renamed at the MCP boundary, not in storage or REST."""

import asyncio

import pytest

from mcp_handler import business_tree, mcp
from scanner import Scanner
from tests.fixtures import ManifestBuilder


def test_only_new_mcp_name_is_registered():
    tools = {tool.name: tool for tool in asyncio.run(mcp.list_tools())}
    assert "business_tree" in tools
    assert "contexts" not in tools
    assert tools["business_tree"].inputSchema["properties"] == {}
    assert tools["business_tree"].outputSchema is not None


@pytest.mark.asyncio
async def test_mcp_keeps_tree_data_and_rest_contract(client, db, duet_data_builder, monkeypatch):
    builder = duet_data_builder
    builder.add_root_context("Venture")
    builder.build(monkeypatch)
    root = builder.get_root_context_path(0)
    ManifestBuilder.context(
        root / "Lab", "Lab", git_repos={"Product": "https://example.com/product.git"}
    )
    # Organizational areas without a manifest are not registry nodes.
    area = root / "Lab" / "Research"
    area.mkdir()
    (area / "INDEX.md").write_text("# Research\n\nAn inherited business area.\n")
    Scanner(db, repos_path=builder.get_repos_path()).scan()

    response = await client.get("/contexts")
    assert response.status_code == 200
    expected = response.json()["contexts"]
    assert business_tree() == expected
    assert [item["name"] for item in expected] == ["Venture", "Lab"]
    venture, lab = expected
    assert lab["parent_id"] == venture["id"]
    assert lab["git_repos"] == {"Product": "https://example.com/product.git"}
    assert lab["absolute_path"] == str(root / "Lab")
    assert lab["type"] == "context"

    _, structured = await mcp.call_tool("business_tree", {})
    assert structured == {"result": expected}


@pytest.mark.asyncio
async def test_empty_tree(client):
    _, structured = await mcp.call_tool("business_tree", {})
    assert structured == {"result": []}
