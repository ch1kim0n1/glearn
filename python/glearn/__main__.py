"""Launcher entry point for the ``glearn`` console script.

Locates a Node.js runtime (>= 18), then executes the JavaScript CLI bundle
that ships inside this wheel, forwarding all arguments, stdio, and the exit
code. This package contains no Python logic of its own; it only delegates to
Node.js.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

MIN_NODE_MAJOR = 18


def _bundle_path() -> str:
    """Absolute path to the bundled CLI JavaScript, shipped as package data."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "_bundle", "glearn.cli.js")


def _find_node() -> str | None:
    """Return the path to a usable ``node`` executable, or ``None``."""
    return shutil.which("node")


def _node_major_version(node: str) -> int | None:
    """Return Node's major version number, or ``None`` if undetectable."""
    try:
        out = subprocess.run(
            [node, "--version"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    # Output looks like "v20.17.0".
    ver = out.lstrip("vV")
    try:
        return int(ver.split(".", 1)[0])
    except (ValueError, IndexError):
        return None


def main() -> int:
    node = _find_node()
    if node is None:
        sys.stderr.write(
            "error: 'glearn' requires Node.js (>= %d) but no 'node' executable "
            "was found on your PATH.\n"
            "Install Node.js from https://nodejs.org/ and try again.\n"
            % MIN_NODE_MAJOR
        )
        return 1

    major = _node_major_version(node)
    if major is not None and major < MIN_NODE_MAJOR:
        sys.stderr.write(
            "error: 'glearn' requires Node.js >= %d, but the 'node' on your "
            "PATH reports major version %d.\n"
            "Upgrade Node.js from https://nodejs.org/ and try again.\n"
            % (MIN_NODE_MAJOR, major)
        )
        return 1

    bundle = _bundle_path()
    if not os.path.isfile(bundle):
        sys.stderr.write(
            "error: the bundled glearn CLI was not found at %s.\n"
            "This indicates a broken installation; try reinstalling glearn.\n"
            % bundle
        )
        return 1

    cmd = [node, bundle, *sys.argv[1:]]

    # On POSIX, replace this process with Node so signals/exit codes pass
    # through transparently. On Windows, os.execv semantics are awkward
    # (the parent returns immediately), so use subprocess and propagate the
    # exit code instead.
    if os.name == "posix":
        os.execv(node, cmd)
        # os.execv does not return on success.
        return 1  # pragma: no cover

    try:
        completed = subprocess.run(cmd)
    except KeyboardInterrupt:
        return 130
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
