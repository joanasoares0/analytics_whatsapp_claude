-- =============================================================================
-- 04_role.sql — The read-only database user
--
-- The agent connects as this user. It gets SELECT on the two views in `demo`
-- and nothing else: no base tables, no writes, no other schema. That is what
-- makes "the agent does not write to the database" a permission rather than a
-- convention — db/scripts/db_check.py demonstrates the refusals.
--
-- Run it AFTER 03_views.sql, as an administrator (the `postgres` user on
-- Supabase). It needs one variable, the password for the new user:
--
--   python db/scripts/db_setup.py                    (reads AGENT_DB_PASSWORD from .env)
--   psql "$URL" -v agent_password="..." -f db/04_role.sql
--
-- Re-running it is safe: the role is only created if it is missing, and the
-- password and the grants are reapplied every time.
-- =============================================================================

set search_path = demo, public;

-- -----------------------------------------------------------------------------
-- 1. The role itself — able to log in, and nothing more
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'analytics_agent') then
    create role analytics_agent login;
  end if;
end
$$;

-- Only the password and LOGIN are set here. A new role is already NOSUPERUSER,
-- NOCREATEDB, NOCREATEROLE and NOREPLICATION, and spelling those out would fail
-- on Supabase: the `postgres` user has CREATEROLE but is not a superuser, and
-- only a superuser may set the SUPERUSER or REPLICATION attributes.
alter role analytics_agent with login password :'agent_password';

-- So that the agent's SQL can say `vw_sales` instead of `demo.vw_sales`.
alter role analytics_agent set search_path = demo;

-- -----------------------------------------------------------------------------
-- 2. Start from zero — re-running this file must not accumulate privileges
-- -----------------------------------------------------------------------------
revoke all on schema demo                from analytics_agent;
revoke all on all tables in schema demo  from analytics_agent;

-- -----------------------------------------------------------------------------
-- 3. Grant exactly what the agent needs: connect, see the schema, read the
--    two views. Nothing on the base tables — a view runs with its owner's
--    rights, so SELECT on the view is enough and reading `sales` directly
--    stays refused.
-- -----------------------------------------------------------------------------
do $$
begin
  execute format('grant connect on database %I to analytics_agent', current_database());
end
$$;

grant usage  on schema demo to analytics_agent;
grant select on demo.vw_sales, demo.vw_salesperson_performance to analytics_agent;

-- Tables added to `demo` later are NOT granted by default. That is deliberate:
-- a new table only becomes visible to the agent if someone grants it here.
alter default privileges in schema demo revoke all on tables from analytics_agent;
