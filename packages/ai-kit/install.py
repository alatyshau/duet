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
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

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

AI_KIT_CODEX_MCP_NAME = "ai-kit"
AI_KIT_CODEX_TOML_KEY = "model_instructions_file"


def get_python_version():
    """Return (major, minor) tuple of the running interpreter."""
    version_tuple = (sys.version_info.major, sys.version_info.minor)
    version_str = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return version_tuple, version_str


def get_codex_dir() -> Path:
    """Return CODEX_HOME if set, else ~/.codex."""
    env = os.environ.get("CODEX_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".codex"

def codex_cli_available() -> bool:
    """Return True if `codex` CLI is available."""
    try:
        result = subprocess.run(["codex", "--version"], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def print_codex_install_tip():
    """Print short instructions for installing Codex CLI."""
    print("      Install Codex CLI (one of):")
    print("        - brew install codex")
    print("        - npm i -g @openai/codex")
    print("      If you already have the ChatGPT VS Code extension, it may include a bundled `codex` binary; add it to PATH.")

def update_vscode_settings(output_dir: Path, venv_python: Path):
    """Print instructions for updating VS Code settings."""
    mcp_script_path = output_dir / "mcp-server" / "server.py"
    instructions_file = output_dir / "core_instructions_short.md"
    
    # Read instructions content to embed as text, as absolute file paths are often restricted
    instructions_json_val = "\"\""
    try:
        if instructions_file.exists():
             text = instructions_file.read_text(encoding="utf-8")
             instructions_json_val = json.dumps(text) # dumps adds quotes around the string
    except Exception:
        pass

    print("      To enable AI Kit in GitHub Copilot, update your VS Code settings.")
    print("      Open User Settings (JSON): Cmd+Shift+P -> 'Preferences: Open User Settings (JSON)'")
    print("      Add/Merge the following configuration:")
    
    print("\n      // --- Copy from here ---")
    print("      \"github.copilot.mcpServers\": {")
    print("          \"duet-ai-kit\": {")
    print(f"              \"command\": \"{venv_python}\",")
    print(f"              \"args\": [\"{mcp_script_path}\"]")
    print("          }")
    print("      },")
    print("      \"github.copilot.chat.codeGeneration.instructions\": [")
    print("          {")
    print(f"              \"text\": {instructions_json_val}")
    print("          }")
    print("      ]")
    print("      // --- Copy to here ---")


def _is_toml_table_header(line: str) -> bool:
    stripped = line.lstrip()
    if not stripped or stripped.startswith("#"):
        return False
    return stripped.startswith("[")


def upsert_root_toml_string_key(content: str, key: str, value: str) -> str:
    """Upsert a root-level TOML string key without clobbering tables."""
    lines = content.splitlines(keepends=True)
    if not lines:
        lines = []

    table_start = next((i for i, line in enumerate(lines) if _is_toml_table_header(line)), len(lines))

    key_re = re.compile(rf"^(\s*){re.escape(key)}\s*=")
    for i in range(table_start):
        stripped = lines[i].lstrip()
        if stripped.startswith("#"):
            continue
        match = key_re.match(lines[i])
        if match:
            indent = match.group(1) or ""
            toml_value = json.dumps(value)
            lines[i] = f"{indent}{key} = {toml_value}\n"
            return "".join(lines)

    insert_at = 0
    while insert_at < table_start:
        stripped = lines[insert_at].strip()
        if stripped == "" or stripped.startswith("#"):
            insert_at += 1
            continue
        break

    toml_value = json.dumps(value)
    block = [
        "# AI Kit entrypoint (managed)\n",
        f"{key} = {toml_value}\n",
        "\n",
    ]
    lines[insert_at:insert_at] = block
    return "".join(lines)


def configure_codex_instructions(output_dir: Path, codex_dir: Path):
    """Configure Codex to always load AI Kit instructions (root-level entrypoint)."""
    codex_dir.mkdir(parents=True, exist_ok=True)
    config_file = codex_dir / "config.toml"

    instructions_file = str((output_dir / "core_instructions_short.md").resolve())

    existing = config_file.read_text(encoding="utf-8") if config_file.exists() else ""
    updated = upsert_root_toml_string_key(existing, AI_KIT_CODEX_TOML_KEY, instructions_file)
    if updated != existing:
        config_file.write_text(updated, encoding="utf-8")
        print(f"      {config_file} updated ✓")
    else:
        print(f"      {config_file} already configured ✓")


def configure_codex_mcp(venv_python: Path, output_dir: Path):
    """Configure Codex MCP server 'ai-kit'."""
    server_script = output_dir / "mcp-server" / "server.py"
    if not server_script.exists():
        print("      Codex MCP skipped (server.py missing)")
        return

    if not codex_cli_available():
        print("      'codex' CLI not found — skipped MCP")
        return

    add_cmd = ["codex", "mcp", "add", AI_KIT_CODEX_MCP_NAME, "--", str(venv_python), str(server_script)]
    try:
        result = subprocess.run(add_cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"      Codex MCP '{AI_KIT_CODEX_MCP_NAME}' ✓")
            return
    except FileNotFoundError:
        print("      'codex' CLI not found — skipped MCP")
        return

    # May already exist — try remove then add.
    try:
        subprocess.run(["codex", "mcp", "remove", AI_KIT_CODEX_MCP_NAME], capture_output=True, text=True)
        result = subprocess.run(add_cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"      Codex MCP '{AI_KIT_CODEX_MCP_NAME}' ✓ (updated)")
        else:
            print(f"      Codex MCP failed: {result.stderr.strip()}")
    except FileNotFoundError:
        print("      'codex' CLI not found — skipped MCP")


def install(
    output_dir: Path,
    *,
    codex: bool = True,
    codex_dir: Optional[Path] = None,
    codex_instructions: bool = True,
    codex_mcp: bool = True,
    vscode: bool = True,
):
    """Install AI Kit."""

    venv_dir = output_dir.parent / ".venv"
    venv_python = venv_dir / "bin" / "python3"

    # Step 1: Check Python
    print("[1/6] Checking Python...")

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
    print("\n[2/6] Setting up venv...")

    if not venv_dir.exists():
        subprocess.run(
            [sys.executable, "-m", "venv", str(venv_dir)],
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
    print("\n[3/6] Copying files...")

    settings_file = output_dir / "settings.json"
    saved_settings = settings_file.read_text() if settings_file.exists() else None

    if output_dir.exists():
        shutil.rmtree(output_dir)

    shutil.copytree(
        TEMPLATES_DIR,
        output_dir,
        ignore=shutil.ignore_patterns("_legacy"),
    )

    if MCP_SERVER_DIR.exists():
        shutil.copytree(MCP_SERVER_DIR, output_dir / "mcp-server")

    if saved_settings:
        settings_file.write_text(saved_settings)
    else:
        settings_file.write_text(json.dumps(DEFAULT_SETTINGS, indent=4) + "\n")

    print(f"      {output_dir} ✓")

    # Step 4: Configure Claude Code
    print("\n[4/6] Configuring Claude Code...")

    # Check if claude CLI is available and working
    result = subprocess.run(
        ["claude", "--version"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        print("      'claude' CLI not found — skipped")
        print("      Tip: install Claude Code to enable Claude integration")
    else:
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
        import_line = f"@{output_dir}/core_instructions_short.md"

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

    # Step 5: Configure Codex
    print("\n[5/6] Configuring Codex...")
    if not codex:
        print("      skipped")
    else:
        resolved_codex_dir = (codex_dir or get_codex_dir()).expanduser()
        codex_cli = codex_cli_available()

        if not resolved_codex_dir.exists() and not codex_cli:
            print("      skipped (Codex not detected)")
            print(f"      Target: {resolved_codex_dir}")
            print_codex_install_tip()
        else:
            if codex_instructions:
                configure_codex_instructions(output_dir, resolved_codex_dir)
            else:
                print("      Codex instructions skipped")

            if codex_mcp:
                if codex_cli:
                    configure_codex_mcp(venv_python, output_dir)
                else:
                    print("      Codex MCP skipped ('codex' CLI not found)")
                    print_codex_install_tip()
            else:
                print("      Codex MCP skipped")

    # Step 6: Configure VS Code
    print("\n[6/6] Configuring VS Code...")
    if not vscode:
        print("      skipped")
    else:
        update_vscode_settings(output_dir, venv_python)

    print("\nDone. Restart VS Code / Codex / Claude Code to apply changes.") 



def main():
    import argparse
    parser = argparse.ArgumentParser(description="Install AI Kit")
    parser.add_argument("-o", "--output", type=Path, required=True,
                        help="Output directory (e.g., ~/DuetData/ai-kit)")
    parser.add_argument("--no-codex", action="store_true",
                        help="Skip Codex configuration")
    parser.add_argument("--codex-dir", type=Path,
                        help="Codex home directory (default: $CODEX_HOME or ~/.codex)")
    parser.add_argument("--no-codex-instructions", action="store_true",
                        help="Skip setting ~/.codex/config.toml model_instructions_file")
    parser.add_argument("--no-codex-mcp", action="store_true",
                        help="Skip configuring MCP server in Codex")
    parser.add_argument("--no-vscode", action="store_true",
                        help="Skip VS Code configuration instructions")
    args = parser.parse_args()

    install(
        args.output.expanduser().resolve(),
        codex=(not args.no_codex),
        codex_dir=args.codex_dir,
        codex_instructions=(not args.no_codex_instructions),
        codex_mcp=(not args.no_codex_mcp),
        vscode=(not args.no_vscode),
    )


if __name__ == "__main__":
    main()
