"""Shared helpers for the database scripts.

Not meant to be run on its own. db_setup.py and db_check.py import from here.
"""

from __future__ import annotations

import pathlib
import os
import re
import sys
from urllib.parse import urlparse

try:
    import psycopg
    from psycopg import sql
    from dotenv import load_dotenv
except ModuleNotFoundError as exc:  # pragma: no cover - guidance, not logic
    sys.exit(
        f"Missing dependency: {exc.name}\n"
        "Install the project dependencies first:\n"
        "  uv sync            (or)  pip install 'psycopg[binary]' python-dotenv"
    )

def _project_root() -> pathlib.Path:
    """Walk up from this file until the project root shows up.

    Written this way so the scripts keep working wherever they are moved to —
    the root is the folder holding pyproject.toml and db/, not a fixed number
    of levels up.
    """
    here = pathlib.Path(__file__).resolve()
    for candidate in here.parents:
        if (candidate / "pyproject.toml").exists() and (candidate / "db").is_dir():
            return candidate
    sys.exit(f"Could not find the project root above {here}")


ROOT = _project_root()
DB_DIR = ROOT / "db"
ENV_FILE = ROOT / ".env"

# The scripts, in the only order that works.
SQL_FILES = ["01_schema.sql", "02_seed.sql", "03_views.sql", "04_role.sql"]

AGENT_ROLE = "analytics_agent"


def load_env() -> None:
    """Read .env from the project root. Values already in the environment win."""
    if not ENV_FILE.exists():
        sys.exit(f"No .env found at {ENV_FILE}. Copy .env.example to .env and fill it in.")
    load_dotenv(ENV_FILE)


def admin_url() -> str:
    """The connection used to BUILD the database — an administrator.

    On Supabase that is the `postgres` user. Falls back to SUPABASE_DB_URL so
    that a project with a single URL in .env still works.
    """
    url = os.getenv("SUPABASE_DB_ADMIN_URL") or os.getenv("SUPABASE_DB_URL")
    if not url or url.startswith("postgresql://<"):
        sys.exit(
            "No admin connection string.\n"
            "Set SUPABASE_DB_ADMIN_URL in .env (Supabase → Project Settings → "
            "Database → Connection string), using the `postgres` user."
        )
    return url


def agent_url() -> str | None:
    """The read-only connection the agent itself uses, if it is configured."""
    url = os.getenv("SUPABASE_DB_URL")
    if not url or url.startswith("postgresql://<"):
        return None
    return url


def describe(url: str) -> str:
    """A printable version of a connection string, with the password removed."""
    p = urlparse(url)
    port = f":{p.port}" if p.port else ""
    return f"{p.username}@{p.hostname}{port}/{p.path.lstrip('/')}"


def connect(url: str, *, autocommit: bool = False) -> psycopg.Connection:
    """Open a connection, translating the usual failures into plain advice."""
    try:
        # prepare_threshold=None keeps this working through Supabase's
        # transaction pooler (port 6543), which does not support prepared
        # statements.
        return psycopg.connect(url, autocommit=autocommit, prepare_threshold=None)
    except psycopg.OperationalError as exc:
        message = str(exc).strip()
        hint = ""
        if "Network is unreachable" in message or "resolve host" in message:
            hint = (
                "\nHint: the direct host (db.<ref>.supabase.co) is IPv6-only unless your\n"
                "project has the IPv4 add-on. If your network has no IPv6, use the pooler\n"
                "connection string instead: host ...pooler.supabase.com, port 5432 (session\n"
                "mode), user postgres.<ref>."
            )
        elif "password authentication failed" in message:
            hint = (
                "\nHint: a password with @ : / ? # breaks the URL. Percent-encode it "
                "(# -> %23, @ -> %40)."
            )
        sys.exit(f"Could not connect to {describe(url)}\n{message}{hint}")


def read_sql(name: str, variables: dict[str, str] | None = None, *, conn=None) -> str:
    """Read a .sql file from db/, filling in any psql-style :'variables'."""
    path = DB_DIR / name
    if not path.exists():
        sys.exit(f"Missing SQL file: {path}")
    text = path.read_text(encoding="utf-8")

    for key, value in (variables or {}).items():
        placeholder = f":'{key}'"
        if placeholder in text:
            literal = sql.Literal(value).as_string(conn) if conn else f"'{value}'"
            text = text.replace(placeholder, literal)

    leftover = re.findall(r":'([a-z_]+)'", text)
    if leftover:
        sys.exit(f"{name} still expects the variable(s): {', '.join(sorted(set(leftover)))}")
    return text


def run_sql(conn: psycopg.Connection, statements: str) -> None:
    """Run a whole script inside a single transaction: all of it, or none."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(statements)
