#!/usr/bin/env python3
"""
AI Kit Installer.

1. Checks Python 3.10+
2. Creates venv and installs dependencies
3. Copies AI Kit files
4. Configures Claude Code (if installed)

Usage:
    python3 install.py -o ~/DuetData/ai-kit
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
TEMPLATES_DIR = SCRIPT_DIR / "templates"
MCP_SERVER_DIR = SCRIPT_DIR / "mcp-server"
CLAUDE_DIR = Path.home() / ".claude"

DEFAULT_SETTINGS = {
    "timestampTZ": {
        "id": "Z",
        "value": "UTC"
    }
}


def get_python_version():
    """Return (major, minor) tuple or None if python3 not found."""
    try:
        result = subprocess.run(
            ["python3", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0:
            return None
        # "Python 3.14.2" → (3, 14)
        version_str = result.stdout.strip().split()[1]
        parts = version_str.split(".")
        return (int(parts[0]), int(parts[1])), version_str
    except Exception:
        return None, None


def install(output_dir: Path):
    """Install AI Kit."""

    venv_dir = output_dir.parent / ".venv"
    venv_python = venv_dir / "bin" / "python3"

    # Step 1: Check Python
    print("[1/4] Checking Python...")

    version_tuple, version_str = get_python_version()

    if version_tuple is None:
        print("      python3 not found")
        print("\n      Ask your AI assistant:")
        print("      ┌─────────────────────────────────────────────────────┐")
        print("      │ 'python3' command not found                         │")
        print("      │ I need Python 3.10+ for AI Kit                      │")
        print("      │ Help me install it                                  │")
        print("      └─────────────────────────────────────────────────────┘")
        sys.exit(1)

    if version_tuple < (3, 10):
        print(f"      python3 = {version_str} (need 3.10+)")
        print("\n      Ask your AI assistant:")
        print("      ┌─────────────────────────────────────────────────────┐")
        print(f"      │ My 'python3' points to Python {version_str}")
        print("      │ I need it to point to Python 3.10+                  │")
        print("      │ Help me fix my PATH or shell config                 │")
        print("      └─────────────────────────────────────────────────────┘")
        sys.exit(1)

    print(f"      python3 = {version_str} ✓")

    # Step 2: Setup venv
    print("\n[2/4] Setting up venv...")

    if not venv_dir.exists():
        subprocess.run(
            ["python3", "-m", "venv", str(venv_dir)],
            check=True
        )
        print(f"      {venv_dir} created")
    else:
        print(f"      {venv_dir} exists")

    # Install mcp
    result = subprocess.run(
        [str(venv_python), "-c", "import mcp"],
        capture_output=True
    )
    if result.returncode != 0:
        print("      Installing mcp...")
        subprocess.run(
            [str(venv_python), "-m", "pip", "install", "-q", "mcp"],
            check=True
        )
    print("      mcp ✓")

    # Step 3: Copy files
    print("\n[3/4] Copying files...")

    settings_file = output_dir / "settings.json"
    saved_settings = settings_file.read_text() if settings_file.exists() else None

    if output_dir.exists():
        shutil.rmtree(output_dir)

    shutil.copytree(TEMPLATES_DIR, output_dir)

    if MCP_SERVER_DIR.exists():
        shutil.copytree(MCP_SERVER_DIR, output_dir / "mcp-server")

    if saved_settings:
        settings_file.write_text(saved_settings)
    else:
        settings_file.write_text(json.dumps(DEFAULT_SETTINGS, indent=4) + "\n")

    print(f"      {output_dir} ✓")

    # Step 4: Configure Claude Code
    print("\n[4/4] Configuring Claude Code...")

    # Check if claude CLI is available and working
    result = subprocess.run(
        ["claude", "--version"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        print("      'claude' CLI not found — skipped")
        print("\n      Install Claude Code, then run this script again.")
        return

    claude_version = result.stdout.strip()
    print(f"      {claude_version} ✓")

    # MCP server via CLI
    server_script = str(output_dir / "mcp-server" / "server.py")

    result = subprocess.run(
        ["claude", "mcp", "add", "-s", "user", "ai-kit", "--",
         str(venv_python), server_script],
        capture_output=True,
        text=True
    )
    if result.returncode == 0:
        print("      MCP server 'ai-kit' ✓")
    else:
        # May already exist, try to update by removing first
        subprocess.run(
            ["claude", "mcp", "remove", "-s", "user", "ai-kit"],
            capture_output=True
        )
        result = subprocess.run(
            ["claude", "mcp", "add", "-s", "user", "ai-kit", "--",
             str(venv_python), server_script],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print("      MCP server 'ai-kit' ✓ (updated)")
        else:
            print(f"      MCP server failed: {result.stderr}")

    # CLAUDE.md — create if missing, instruct if exists without import
    claude_md = CLAUDE_DIR / "CLAUDE.md"
    import_line = f"@{output_dir}/core_instructions.md"

    if claude_md.exists():
        content = claude_md.read_text()
        if import_line in content:
            print(f"      {claude_md} already configured")
        else:
            print(f"\n      Add this line to {claude_md}:")
            print("      ┌─────────────────────────────────────────────────────┐")
            print(f"      │ {import_line}")
            print("      └─────────────────────────────────────────────────────┘")
    else:
        claude_md.write_text(import_line + "\n")
        print(f"      {claude_md} created ✓")

    print("\nDone. Restart Claude Code to apply changes.")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Install AI Kit")
    parser.add_argument("-o", "--output", type=Path, required=True,
                        help="Output directory (e.g., ~/DuetData/ai-kit)")
    args = parser.parse_args()

    install(args.output.expanduser().resolve())


if __name__ == "__main__":
    main()
