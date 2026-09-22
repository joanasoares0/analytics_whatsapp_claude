#!/usr/bin/env python3
"""Build the demo database on Supabase.

Runs the SQL in db/ against the admin connection, in order:

    01_schema.sql  the schema `demo` and its three tables
    02_seed.sql    the data (WIPES the three tables first)
    03_views.sql   the two read views
    04_role.sql    the read-only user the agent connects as

Two of the steps destroy data, and the script asks before each of them:
01_schema.sql drops and recreates the tables, 02_seed.sql truncates them.

Usage:
    python db/scripts/db_setup.py                 # everything, asking first
    python db/scripts/db_setup.py --only 03 04    # just the views and the role
    python db/scripts/db_setup.py --yes           # no questions (for CI)

Reads SUPABASE_DB_ADMIN_URL (the `postgres` user) and AGENT_DB_PASSWORD
from .env at the project root.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from urllib.parse import urlparse

from _db import AGENT_ROLE, SQL_FILES, admin_url, connect, describe, load_env, read_sql, run_sql


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="STEP",
        help="run only these steps, by number: 01 02 03 04",
    )
    parser.add_argument(
        "--skip-seed",
        action="store_true",
        help="leave out 02_seed.sql (01_schema.sql still recreates the tables)",
    )
    parser.add_argument("--yes", action="store_true", help="do not ask before destroying data")
    return parser.parse_args()


def chosen_files(args: argparse.Namespace) -> list[str]:
    files = SQL_FILES
    if args.only:
        wanted = {step.split("_")[0].zfill(2) for step in args.only}
        unknown = wanted - {name[:2] for name in SQL_FILES}
        if unknown:
            sys.exit(f"Unknown step(s): {', '.join(sorted(unknown))}. Valid: 01 02 03 04")
        files = [name for name in SQL_FILES if name[:2] in wanted]
    if args.skip_seed:
        files = [name for name in files if not name.startswith("02")]
    return files


# Both of these throw away whatever is in the three tables. CLAUDE.md, rule 4:
# never run them without warning first.
DESTRUCTIVE = {
    "01_schema.sql": "drops and recreates the three tables (and the two views)",
    "02_seed.sql": "starts with a TRUNCATE of sales, targets and salespeople",
}


def confirm(name: str, args: argparse.Namespace) -> bool:
    """Ask before a step that destroys data. Anything but 'yes' skips it."""
    if args.yes:
        return True
    print(f"\n  {name} {DESTRUCTIVE[name]}.")
    print("  Any data already there is lost.")
    return input("  Type 'yes' to run it (anything else skips it): ").strip().lower() == "yes"


def agent_password() -> str:
    password = os.getenv("AGENT_DB_PASSWORD")
    if not password:
        sys.exit(
            "04_role.sql needs AGENT_DB_PASSWORD in .env — the password for the\n"
            "read-only user the agent will connect as. Pick a strong one, then\n"
            "re-run — or build everything else first with `--only 01 02 03`."
        )
    return password


def report_agent_url(url: str) -> None:
    """Print the connection string to put in SUPABASE_DB_URL, password masked."""
    p = urlparse(url)
    port = p.port or 5432
    host = p.hostname
    user = AGENT_ROLE
    # The pooler needs the project ref appended to the user name.
    if host and "pooler.supabase.com" in host and p.username and "." in p.username:
        user = f"{AGENT_ROLE}.{p.username.split('.', 1)[1]}"
    print("\nThe agent connects as the read-only user. Put this in .env, replacing")
    print("the placeholder with the AGENT_DB_PASSWORD you chose:\n")
    print(f"  SUPABASE_DB_URL=postgresql://{user}:<AGENT_DB_PASSWORD>@{host}:{port}/{p.path.lstrip('/')}")
    print("\n  (a password with @ : / ? # has to be percent-encoded: # -> %23, @ -> %40)")


def main() -> int:
    args = parse_args()
    load_env()
    url = admin_url()
    files = chosen_files(args)

    print(f"Target : {describe(url)}")
    print(f"Steps  : {', '.join(files) or '(none)'}")

    variables = {"agent_password": agent_password()} if "04_role.sql" in files else {}

    with connect(url) as conn:
        for name in files:
            if name in DESTRUCTIVE and not confirm(name, args):
                print(f"  {name} .......... skipped")
                continue

            statements = read_sql(name, variables, conn=conn)
            started = time.perf_counter()
            run_sql(conn, statements)
            elapsed = time.perf_counter() - started
            print(f"  {name} .......... ok ({elapsed:.1f}s)")

    print("\nDone.")
    if "04_role.sql" in files:
        report_agent_url(url)
    print("\nNow verify it:  python db/scripts/db_check.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
