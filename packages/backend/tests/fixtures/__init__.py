"""Test fixtures and factories for backend tests.

This module provides reusable test infrastructure:
- EntityFactory: Create Entity objects with sensible defaults
- DuetDataBuilder: Build DuetData directory structure for tests
- ManifestBuilder: Create `context.json` v2 manifest files
"""

from .entities import EntityFactory
from .filesystem import DuetDataBuilder, ManifestBuilder, HierarchyBuilder

__all__ = ["EntityFactory", "DuetDataBuilder", "ManifestBuilder", "HierarchyBuilder"]
