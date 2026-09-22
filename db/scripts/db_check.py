#!/usr/bin/env python3
"""Verify the demo database: the numbers, and the permission wall.

Two independent checks:

  DATA        the seeded numbers still match what db/02_seed.sql promises
  PERMISSION  the agent's user can read the two views and nothing else

Usage:
    python db/scripts/db_check.py

Reads SUPABASE_DB_ADMIN_URL and SUPABASE_DB_URL from .env. The permission
section is skipped when SUPABASE_DB_URL is not the read-only user yet.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from urllib.parse import urlparse

import psycopg

from _db import AGENT_ROLE, admin_url, agent_url, connect, describe, load_env

# What db/02_seed.sql promises. If the seed changes, these change with it.
EXPECTED = {
    "salespeople": 5,
    "sales": 2572,
    "targets": 10,
    "total_revenue": Decimal("17966842.11"),
    "yesterday": Decimal("177545.06"),
    "yesterday_change_pct": Decimal("21.6"),
    "bruno_attainment_pct": Decimal("61.0"),
    "bruno_discount_pct": Decimal("17.7"),
}

PASS, FAIL, SKIP = "  ok  ", " FAIL ", " skip "
failures: list[str] = []


def check(label: str, got, expected=None) -> None:
    ok = got == expected if expected is not None else bool(got)
    mark = PASS if ok else FAIL
    detail = f"{got}" if expected is None or ok else f"{got}  (expected {expected})"
    print(f"[{mark}] {label:<44} {detail}")
    if not ok:
        failures.append(label)


def check_data(url: str) -> None:
    print(f"\nDATA — {describe(url)}")
    with connect(url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("set search_path = demo, public")

        for table in ("salespeople", "sales", "targets"):
            cur.execute(f"select count(*) from {table}")
            check(f"rows in {table}", cur.fetchone()[0], EXPECTED[table])

        cur.execute("select round(sum(net_total), 2) from vw_sales")
        check("total revenue", cur.fetchone()[0], EXPECTED["total_revenue"])

        cur.execute(
            """
            select round(sum(net_total) filter (where days_ago = 1), 2),
                   round(100 * (sum(net_total) filter (where days_ago = 1)
                              / sum(net_total) filter (where days_ago = 2) - 1), 1)
            from sales where days_ago in (1, 2)
            """
        )
        yesterday, change = cur.fetchone()
        check("revenue yesterday", yesterday, EXPECTED["yesterday"])
        check("change vs the day before", change, EXPECTED["yesterday_change_pct"])

        cur.execute(
            """
            select attainment_pct, avg_discount_pct
            from vw_salesperson_performance where salesperson = 'Bruno Tavares'
            """
        )
        row = cur.fetchone()
        if row is None:
            check("Bruno Tavares in the performance view", "missing", "a row")
            return
        check("Bruno Tavares attainment", row[0], EXPECTED["bruno_attainment_pct"])
        check("Bruno Tavares average discount", row[1], EXPECTED["bruno_discount_pct"])

        # The date is computed, not stored: yesterday has to really be yesterday.
        cur.execute("select max(sale_date) = current_date from vw_sales")
        check("the data still reaches today", cur.fetchone()[0], True)


def check_role_exists(url: str) -> None:
    print(f"\nROLE — {describe(url)}")
    with connect(url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("select rolcanlogin, rolsuper from pg_roles where rolname = %s", (AGENT_ROLE,))
        row = cur.fetchone()
        if row is None:
            check(f"role {AGENT_ROLE} exists", "missing", "created by 04_role.sql")
            return
        check(f"role {AGENT_ROLE} can log in", row[0], True)
        check(f"role {AGENT_ROLE} is not a superuser", row[1], False)

        cur.execute(
            """
            select table_name, privilege_type
            from information_schema.role_table_grants
            where grantee = %s and table_schema = 'demo'
            order by table_name, privilege_type
            """,
            (AGENT_ROLE,),
        )
        grants = cur.fetchall()
        readable = sorted({name for name, priv in grants if priv == "SELECT"})
        writes = sorted({f"{priv} on {name}" for name, priv in grants if priv != "SELECT"})
        check("can read exactly the two views", readable,
              ["vw_sales", "vw_salesperson_performance"])
        check("holds no write privilege", writes, [])


def check_permission_wall(url: str) -> None:
    print(f"\nPERMISSION — {describe(url)}")
    username = urlparse(url).username or ""
    if username.split(".")[0] != AGENT_ROLE:
        print(f"[{SKIP}] SUPABASE_DB_URL is not {AGENT_ROLE} yet — see db_setup.py output")
        return

    with connect(url, autocommit=True) as conn:
        def refused(label: str, statement: str) -> None:
            with conn.cursor() as cur:
                try:
                    cur.execute(statement)
                    check(label, "allowed", "refused")
                except psycopg.errors.InsufficientPrivilege:
                    check(label, "refused by the database")
                except psycopg.Error as exc:  # any other refusal still counts
                    check(label, f"refused ({exc.diag.sqlstate})")

        with conn.cursor() as cur:
            cur.execute("select count(*) from demo.vw_sales")
            check("can read vw_sales", cur.fetchone()[0], EXPECTED["sales"])

        refused("cannot read the sales table", "select * from demo.sales limit 1")
        refused("cannot insert", "insert into demo.sales (transaction_id) values ('x')")
        refused("cannot update", "update demo.sales set qty = 0")
        refused("cannot delete", "delete from demo.sales")
        refused("cannot create a table", "create table demo.scratch (id int)")


def main() -> int:
    load_env()
    admin = admin_url()
    check_data(admin)
    check_role_exists(admin)

    agent = agent_url()
    if agent and agent != admin:
        check_permission_wall(agent)
    else:
        print("\nPERMISSION")
        print(f"[{SKIP}] set SUPABASE_DB_URL to the {AGENT_ROLE} connection string to test it")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("Everything checks out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
