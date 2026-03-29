"""SQLite database manager for Duet entities.

Port of packages/extension/src/core/db/index.ts to Python.
Uses native sqlite3 instead of sql.js/WASM.
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from config import get_db_path


EntityType = Literal["business", "stream", "product", "project"]


@dataclass
class Entity:
    id: int | None
    type: EntityType
    name: str
    icon: str
    drive_path: str
    parent_id: int | None = None
    git_url: str | None = None
    status: str | None = None
    root: bool = False


class DatabaseManager:
    """Manages SQLite database for entity hierarchy."""

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or get_db_path()
        self.conn: sqlite3.Connection | None = None

    def init(self) -> None:
        """Initialize database connection and schema."""
        if self.conn:
            return

        # Ensure parent directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        """Create tables and indexes if not exist."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT,
                name TEXT,
                icon TEXT,
                drive_path TEXT UNIQUE,
                parent_id INTEGER REFERENCES entities(id),
                git_url TEXT,
                status TEXT
            )
        """)

        # Global unique index on name
        self.conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_name ON entities(name)"
        )

        # Migrations: add columns that may be missing in older databases
        self._migrate_add_column("entities", "status", "TEXT")
        self._migrate_add_column("entities", "root", "INTEGER DEFAULT 0")

        self.conn.commit()

    def _migrate_add_column(
        self, table: str, column: str, col_type: str
    ) -> None:
        """Add column to table if it doesn't exist (schema migration)."""
        if not self.conn:
            return
        cursor = self.conn.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in cursor.fetchall()}
        if column not in columns:
            self.conn.execute(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            )

    def close(self) -> None:
        """Close database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def clear(self) -> None:
        """Delete all entities from database."""
        if not self.conn:
            raise RuntimeError("Database not initialized")
        self.conn.execute("DELETE FROM entities")
        self.conn.commit()

    def insert_entity(self, entity: Entity) -> int:
        """Insert entity and return its ID.

        Uses INSERT OR IGNORE for idempotency.
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        self.conn.execute(
            """INSERT OR IGNORE INTO entities
               (type, name, icon, drive_path, parent_id, git_url, status, root)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entity.type,
                entity.name,
                entity.icon,
                entity.drive_path,
                entity.parent_id,
                entity.git_url,
                entity.status,
                1 if entity.root else 0,
            ),
        )
        self.conn.commit()

        # Get ID of inserted or existing row
        cursor = self.conn.execute(
            "SELECT id FROM entities WHERE drive_path = ?", (entity.drive_path,)
        )
        row = cursor.fetchone()
        if row:
            return row["id"]

        raise RuntimeError(f"Failed to insert/get entity: {entity.drive_path}")

    def get_entities(self, parent_id: int | None = None) -> list[Entity]:
        """Get entities by parent_id.

        parent_id=None returns root entities (business).
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        if parent_id is None:
            cursor = self.conn.execute(
                "SELECT * FROM entities WHERE parent_id IS NULL"
            )
        else:
            cursor = self.conn.execute(
                "SELECT * FROM entities WHERE parent_id = ?", (parent_id,)
            )

        return [self._row_to_entity(row) for row in cursor.fetchall()]

    def get_all_entities(self) -> list[Entity]:
        """Get all entities."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute("SELECT * FROM entities")
        return [self._row_to_entity(row) for row in cursor.fetchall()]

    def get_entity(self, entity_id: int) -> Entity | None:
        """Get entity by ID."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT * FROM entities WHERE id = ?", (entity_id,)
        )
        row = cursor.fetchone()
        return self._row_to_entity(row) if row else None

    def find_by_name(self, name: str) -> Entity | None:
        """Find entity by name (globally unique)."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT * FROM entities WHERE name = ?", (name,)
        )
        row = cursor.fetchone()
        return self._row_to_entity(row) if row else None

    def name_exists(self, name: str) -> bool:
        """Check if name exists in database."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT 1 FROM entities WHERE name = ? LIMIT 1", (name,)
        )
        return cursor.fetchone() is not None

    def update_entity_name(self, entity_id: int, new_name: str) -> None:
        """Update entity name by ID."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        self.conn.execute(
            "UPDATE entities SET name = ? WHERE id = ?", (new_name, entity_id)
        )
        self.conn.commit()

    def has_children(
        self, parent_id: int, exclude_types: list[str] | None = None
    ) -> bool:
        """Check if entity has children, optionally excluding types."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        if exclude_types:
            placeholders = ", ".join("?" * len(exclude_types))
            cursor = self.conn.execute(
                f"""SELECT 1 FROM entities
                    WHERE parent_id = ? AND type NOT IN ({placeholders})
                    LIMIT 1""",
                (parent_id, *exclude_types),
            )
        else:
            cursor = self.conn.execute(
                "SELECT 1 FROM entities WHERE parent_id = ? LIMIT 1",
                (parent_id,),
            )

        return cursor.fetchone() is not None

    def find_closest_entity(self, path: str) -> Entity | None:
        """Find deepest entity containing the given path.

        Used for breadcrumb/context detection.
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            """SELECT * FROM entities
               WHERE instr(?, drive_path) = 1
               ORDER BY length(drive_path) DESC
               LIMIT 1""",
            (path,),
        )
        row = cursor.fetchone()
        return self._row_to_entity(row) if row else None

    def get_entity_chain(self, entity_id: int) -> list[Entity]:
        """Get chain from root to entity (for workspace_info)."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        chain: list[Entity] = []
        current_id: int | None = entity_id

        while current_id is not None:
            entity = self.get_entity(current_id)
            if entity is None:
                break
            chain.insert(0, entity)
            current_id = entity.parent_id

        return chain

    def count_children(self, parent_id: int) -> int:
        """Count direct children of an entity."""
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM entities WHERE parent_id = ?", (parent_id,)
        )
        row = cursor.fetchone()
        return row[0] if row else 0

    def get_streams(self) -> list[Entity]:
        """Get streams (business, stream, product) + active projects under business/stream.

        Used for sidebar tree view.
        Active projects under products are excluded (they live in a separate panel).
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute("""
            SELECT * FROM entities WHERE type IN ('business', 'stream', 'product')
            UNION
            SELECT p.* FROM entities p
            JOIN entities parent ON p.parent_id = parent.id
            WHERE p.type = 'project' AND p.status = 'active'
              AND parent.type IN ('business', 'stream')
        """)
        return [self._row_to_entity(row) for row in cursor.fetchall()]

    def get_projects(self, stream_id: int) -> list[Entity]:
        """Get projects for a stream (any level: business, stream, or product).

        Args:
            stream_id: Parent entity ID (business, stream, or product)
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT * FROM entities WHERE parent_id = ? AND type = 'project'",
            (stream_id,),
        )
        return [self._row_to_entity(row) for row in cursor.fetchall()]

    def find_root_business(self) -> Entity | None:
        """Find the root business entity (root=true in business.json).

        Used by multi-path resolution to determine primary business
        when multiple businesses are in workspace_paths.
        """
        if not self.conn:
            raise RuntimeError("Database not initialized")

        cursor = self.conn.execute(
            "SELECT * FROM entities WHERE type = 'business' AND root = 1 LIMIT 1"
        )
        row = cursor.fetchone()
        return self._row_to_entity(row) if row else None

    def _row_to_entity(self, row: sqlite3.Row) -> Entity:
        """Convert database row to Entity."""
        return Entity(
            id=row["id"],
            type=row["type"],
            name=row["name"],
            icon=row["icon"],
            drive_path=row["drive_path"],
            parent_id=row["parent_id"],
            git_url=row["git_url"],
            status=row["status"],
            root=bool(row["root"]) if row["root"] else False,
        )
