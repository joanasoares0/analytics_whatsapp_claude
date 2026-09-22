-- =============================================================================
-- 01_schema.sql — Structure of the demo database
-- Project:  Business Analysis over WhatsApp
-- Database: PostgreSQL 15+ (Supabase)
-- Domain:   technology product sales (B2B/B2C), currency R$
--
-- DESIGN DECISION — RELATIVE DATES
-- The `sales` table does NOT store a date. It stores `days_ago` (0 = today,
-- 1 = yesterday). The real date is computed in the `vw_sales` view, as
-- (current_date - days_ago).
-- Consequence: the data never ages. "Yesterday" is always yesterday, with no
-- cron, no ingestion job, no moving part on the day of the recording.
--
-- ITS OWN SCHEMA, NOT `public`
-- Two reasons. (1) The Supabase project is shared with another application —
-- a separate schema rules out a name collision the day this seed runs again.
-- (2) A table in `public` is readable through the REST API with the publishable
-- key, which is public by definition. A schema outside PostgREST is not.
-- =============================================================================

create schema if not exists demo;
set search_path = demo, public;

drop view  if exists vw_salesperson_performance;
drop view  if exists vw_sales;
drop table if exists sales;
drop table if exists targets;
drop table if exists salespeople;

-- -----------------------------------------------------------------------------
-- salespeople — the roster. `months_tenure` gives the agent context for its
--               recommendations (a new rep below target != a veteran below target)
-- -----------------------------------------------------------------------------
create table salespeople (
  salesperson    text primary key,
  home_region    text not null,
  months_tenure  int  not null
);

-- -----------------------------------------------------------------------------
-- sales — grain: one row per transaction
-- gross_total and net_total are generated columns: there is no risk of the
-- stored value drifting away from the calculation rule.
-- -----------------------------------------------------------------------------
create table sales (
  transaction_id text          primary key,
  days_ago       int           not null,
  salesperson    text          not null references salespeople(salesperson),
  region         text          not null,
  city           text          not null,
  channel        text          not null,
  product        text          not null,
  category       text          not null,
  qty            int           not null,
  unit_price     numeric(12,2) not null,
  discount_pct   numeric(5,4)  not null,
  gross_total    numeric(14,2) generated always as (qty * unit_price) stored,
  net_total      numeric(14,2) generated always as (round(qty * unit_price * (1 - discount_pct), 2)) stored
);

create index idx_sales_days        on sales (days_ago);
create index idx_sales_salesperson on sales (salesperson);
create index idx_sales_product     on sales (product);
create index idx_sales_region      on sales (region);

-- -----------------------------------------------------------------------------
-- targets — monthly target per salesperson. months_ago: 0 = current month,
--           1 = last month
-- -----------------------------------------------------------------------------
create table targets (
  salesperson   text          not null references salespeople(salesperson),
  months_ago    int           not null,
  target_amount numeric(14,2) not null,
  primary key (salesperson, months_ago)
);
