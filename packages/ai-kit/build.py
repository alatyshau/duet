#!/usr/bin/env python3
"""
Build script for .ai/ directory.
Mirrors templates/ structure to .ai/, rendering .j2 → .md
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, List

try:
    from jinja2 import Environment, FileSystemLoader
except ImportError:
    print("Error: jinja2 not installed. Run: pip install jinja2")
    sys.exit(1)


# Paths
SCRIPT_DIR = Path(__file__).parent
TEMPLATES_DIR = SCRIPT_DIR / "templates"
INCLUDES_DIR = TEMPLATES_DIR / "_includes"

# Output directory (relative to repo root)
REPO_ROOT = Path(__file__).parent.parent.parent
DEFAULT_AI_DIR = REPO_ROOT / ".ai"


def get_ai_dir() -> Path:
    """Get .ai directory from env or use default."""
    env_path = os.environ.get("AI_OUTPUT_DIR")
    if env_path:
        return Path(env_path)
    return DEFAULT_AI_DIR


def build_all(
    ai_dir: Optional[Path] = None,
    project_name: str = "Duet",
    version: str = "1.0.0",
    **extra_vars
) -> List[Path]:
    """
    Build all templates — mirror templates/ structure to .ai/.

    - Recursively walks templates/
    - Skips _includes/ (only used for {% include %})
    - Renders .j2 files to .md
    - Preserves directory structure

    Args:
        ai_dir: Output .ai directory (default: ../../.ai/)
        project_name: Project name for templates
        version: Version string for templates
        **extra_vars: Additional template variables

    Returns:
        List of generated file paths
    """
    ai_dir = ai_dir or get_ai_dir()
    ai_dir.mkdir(parents=True, exist_ok=True)

    # Setup Jinja2 — include all dirs for {% include %} resolution
    env = Environment(
        loader=FileSystemLoader([str(TEMPLATES_DIR)]),
        trim_blocks=True,
        lstrip_blocks=True,
    )

    # Common variables for all templates
    common_vars = {
        "project_name": project_name,
        "version": version,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        **extra_vars
    }

    generated = []

    # Walk templates/ recursively
    for template_file in TEMPLATES_DIR.rglob("*.j2"):
        # Skip _includes/
        if "_includes" in template_file.parts:
            continue

        # Calculate relative path from templates/
        rel_path = template_file.relative_to(TEMPLATES_DIR)

        # Template name for Jinja2 (relative to TEMPLATES_DIR)
        template_name = str(rel_path)

        # Output path: .j2 → .md, preserve structure
        output_rel = rel_path.with_suffix("").with_suffix(".md") if rel_path.suffix == ".j2" else rel_path
        # Handle double extensions like .md.j2
        if template_file.name.endswith(".md.j2"):
            output_rel = rel_path.parent / template_file.name.replace(".j2", "")

        output_path = ai_dir / output_rel

        # Ensure parent directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            template = env.get_template(template_name)
            rendered = template.render(**common_vars)

            output_path.write_text(rendered, encoding="utf-8")

            print(f"Generated: {output_path}")
            generated.append(output_path)

        except Exception as e:
            print(f"Error rendering {template_name}: {e}", file=sys.stderr)

    return generated


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Build .ai/ from templates/")
    parser.add_argument(
        "-o", "--output",
        type=Path,
        help="Output .ai directory (default: ../../.ai/)"
    )
    parser.add_argument(
        "-p", "--project",
        default="Duet",
        help="Project name (default: Duet)"
    )
    parser.add_argument(
        "-v", "--version",
        default="1.0.0",
        help="Version string (default: 1.0.0)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be generated without writing files"
    )

    args = parser.parse_args()
    ai_dir = args.output or get_ai_dir()

    if args.dry_run:
        print("Templates (templates/ → .ai/):\n")
        for t in TEMPLATES_DIR.rglob("*.j2"):
            if "_includes" in t.parts:
                continue
            rel_path = t.relative_to(TEMPLATES_DIR)
            if t.name.endswith(".md.j2"):
                output_name = t.name.replace(".j2", "")
            else:
                output_name = t.stem + ".md"
            output_rel = rel_path.parent / output_name
            print(f"  {rel_path} → .ai/{output_rel}")

        print(f"\nOutput directory: {ai_dir}")
        return

    generated = build_all(
        ai_dir=args.output,
        project_name=args.project,
        version=args.version,
    )

    print(f"\nGenerated {len(generated)} files.")

    # Step 12: Sync root files
    copy_to_root(ai_dir)


def copy_to_root(ai_dir: Path):
    """
    Step 12: Copy .ai/INSTRUCTIONS.md to root aliases:
    - AGENTS.md
    - CLAUDE.md
    - GEMINI.md
    """
    source = ai_dir / "INSTRUCTIONS.md"
    if not source.exists():
        print(f"⚠️ Warning: {source} not found, skipping root sync.")
        return

    content = source.read_text(encoding="utf-8")
    
    root_aliases = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]
    
    print("\nSyncing root aliases:")
    for alias in root_aliases:
        dest = REPO_ROOT / alias
        dest.write_text(content, encoding="utf-8")
        print(f"  -> {dest.name} (synced)")


if __name__ == "__main__":
    main()
