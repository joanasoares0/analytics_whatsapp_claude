-- =============================================================================
-- 03_views.sql — The read layer
--
-- The agent NEVER queries the `sales` table directly. It only ever sees the
-- views. Reason: the table stores `days_ago`, not a date. The view is what
-- translates that into a calendar. This keeps the rule in a single place and
-- stops the agent from inventing date arithmetic of its own.
-- =============================================================================

set search_path = demo, public;

-- -----------------------------------------------------------------------------
-- vw_sales — the source of truth for any transactional analysis
-- -----------------------------------------------------------------------------
create or replace view vw_sales as
select
  s.transaction_id,
  (current_date - s.days_ago)                                    as sale_date,
  extract(year  from (current_date - s.days_ago))::int           as sale_year,
  extract(month from (current_date - s.days_ago))::int           as sale_month,
  (array['January','February','March','April','May','June',
         'July','August','September','October','November','December']
  )[extract(month from (current_date - s.days_ago))::int]        as month_name,
  s.salesperson,
  s.region,
  s.city,
  s.channel,
  s.product,
  s.category,
  s.qty,
  s.unit_price,
  s.discount_pct,
  s.gross_total,
  s.net_total
from sales s;

-- -----------------------------------------------------------------------------
-- vw_salesperson_performance — target vs actual, rolling 30-day window
--
-- A ROLLING WINDOW, NOT A CALENDAR MONTH. Month-to-date holds anywhere from 1
-- to 31 days of data depending on when the question is asked; early in the
-- month the ranking turns into statistical noise. 30 running days give the
-- same reading on any date.
--
-- The view does not hand over attainment alone. It also hands over
-- avg_order_value and avg_discount_pct — which are the CAUSE of the
-- attainment. Without those two columns the agent can say who is behind, but
-- not why, and the recommendation turns generic ("needs to sell more").
-- -----------------------------------------------------------------------------
create or replace view vw_salesperson_performance as
with actual as (
  select
    s.salesperson,
    sum(s.net_total)                 as actual_revenue,
    count(*)                         as orders,
    avg(s.discount_pct)              as avg_discount,
    sum(s.net_total) / count(*)      as avg_order_value
  from sales s
  where s.days_ago between 1 and 30
  group by s.salesperson
)
select
  sp.salesperson,
  sp.home_region,
  sp.months_tenure,
  coalesce(a.actual_revenue, 0)                                  as actual_revenue,
  t.target_amount                                                as planned_target,
  coalesce(a.actual_revenue, 0) - t.target_amount                as variance,
  round(100 * coalesce(a.actual_revenue, 0) / t.target_amount, 1) as attainment_pct,
  coalesce(a.orders, 0)                                          as orders,
  round(coalesce(a.avg_order_value, 0), 2)                       as avg_order_value,
  round(coalesce(a.avg_discount, 0) * 100, 1)                    as avg_discount_pct,
  case
    when coalesce(a.actual_revenue, 0) / t.target_amount >= 1.00 then 'Target met'
    when coalesce(a.actual_revenue, 0) / t.target_amount >= 0.90 then 'Near target'
    when coalesce(a.actual_revenue, 0) / t.target_amount >= 0.75 then 'Below target'
    else                                                              'Critical'
  end                                                            as status
from targets t
join salespeople sp on sp.salesperson = t.salesperson
left join actual a  on a.salesperson  = t.salesperson
where t.months_ago = 0;
