-- Adds school and analyst filters to the independent analytics dashboard.
-- Safe to run alongside sti_dashboard_metrics: no OS table or record is changed.
begin;

create table if not exists public.sti_dashboard_managers (
  email text primary key check (email = lower(email) and length(trim(email)) > 3),
  created_at timestamptz not null default now()
);
alter table public.sti_dashboard_managers enable row level security;
revoke all on public.sti_dashboard_managers from anon, authenticated;
insert into public.sti_dashboard_managers(email)
values ('angeloruivo@gmail.com')
on conflict (email) do nothing;

create or replace function public.sti_dashboard_metrics_filtered(
  p_start date default null,
  p_end date default null,
  p_school text default null,
  p_analyst text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_email text := lower(coalesce(auth.jwt()->>'email', ''));
  result jsonb;
begin
  if actor is null then
    raise exception 'STI_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.sti_dashboard_managers
    where email = actor_email
  ) then
    raise exception 'STI_DASHBOARD_FORBIDDEN';
  end if;
  if p_start is not null and p_end is not null and p_start > p_end then
    raise exception 'STI_INVALID_PERIOD';
  end if;

  with call_docs as (
    select id, user_id, body
    from public.sti_records
    where kind = 'call'
      and coalesce((body->>'archived')::boolean, false) = false
  ), base_visit_rows as (
    select
      c.id as call_id,
      c.user_id,
      c.body->'school'->>'cie' as school_cie,
      c.body->'school'->>'name' as school_name,
      v.value as visit,
      (v.value->>'startedAt')::timestamptz as started_at,
      timezone('America/Sao_Paulo', (v.value->>'startedAt')::timestamptz)::date as visit_day,
      coalesce(nullif(trim(v.value->>'technician'), ''), 'Não informado') as analyst
    from call_docs c
    cross join lateral jsonb_array_elements(c.body->'visits') v(value)
    where v.value->>'endedAt' is not null
      and (p_start is null or timezone('America/Sao_Paulo', (v.value->>'startedAt')::timestamptz)::date >= p_start)
      and (p_end is null or timezone('America/Sao_Paulo', (v.value->>'startedAt')::timestamptz)::date <= p_end)
  ), filter_schools as (
    select distinct
      coalesce(nullif(school_cie, ''), school_name) as value,
      coalesce(nullif(school_name, ''), 'Escola não informada') as name,
      coalesce(school_cie, '') as cie
    from base_visit_rows
    where coalesce(nullif(school_cie, ''), school_name) is not null
  ), filter_analysts as (
    select distinct analyst as name
    from base_visit_rows
  ), visit_rows as (
    select *
    from base_visit_rows
    where (p_school is null or coalesce(nullif(school_cie, ''), school_name) = p_school)
      and (p_analyst is null or analyst = p_analyst)
  ), visit_entries as (
    select
      v.*,
      e.value as equipment,
      row_number() over (
        partition by v.call_id, e.value->>'id'
        order by v.started_at desc, v.visit->>'id' desc
      ) as latest_position
    from visit_rows v
    cross join lateral jsonb_array_elements(v.visit->'entries') e(value)
  ), latest_equipment as (
    select * from visit_entries where latest_position = 1
  ), school_visits as (
    select school_cie as cie, school_name as name, count(*)::integer as visits,
      count(distinct call_id)::integer as calls
    from visit_rows
    group by school_cie, school_name
  ), school_equipment as (
    select school_cie as cie, school_name as name, count(*)::integer as equipment
    from latest_equipment
    group by school_cie, school_name
  ), school_metrics as (
    select s.cie, s.name, s.visits, s.calls, coalesce(e.equipment, 0)::integer as equipment
    from school_visits s
    left join school_equipment e using (cie, name)
  ), analyst_visits as (
    select analyst as name, count(*)::integer as visits,
      count(distinct call_id)::integer as calls
    from visit_rows
    group by analyst
  ), analyst_equipment as (
    select analyst as name, count(*)::integer as equipment
    from latest_equipment
    group by analyst
  ), analyst_metrics as (
    select a.name, a.visits, a.calls, coalesce(e.equipment, 0)::integer as equipment
    from analyst_visits a
    left join analyst_equipment e using (name)
  ), model_metrics as (
    select
      equipment->>'manufacturer' as manufacturer,
      equipment->>'model' as model,
      count(*)::integer as total,
      count(*) filter (where equipment->>'status' = 'OK')::integer as ok,
      count(*) filter (where equipment->>'status' = 'NG' and equipment->>'warranty' = 'SIM')::integer as ng_with_warranty,
      count(*) filter (where equipment->>'status' = 'NG' and equipment->>'warranty' = 'NAO')::integer as ng_without_warranty,
      count(*) filter (where equipment->>'status' = 'INSERVÍVEL')::integer as unserviceable,
      count(*) filter (where equipment->>'status' = 'REAPROVEITAMENTO')::integer as reuse
    from latest_equipment
    group by equipment->>'manufacturer', equipment->>'model'
  ), daily_visits as (
    select visit_day as day, count(*)::integer as visits
    from visit_rows
    group by visit_day
  ), daily_equipment as (
    select visit_day as day, count(*)::integer as equipment
    from visit_entries
    group by visit_day
  ), daily_metrics as (
    select to_char(v.day, 'YYYY-MM-DD') as date,
      extract(day from v.day)::integer as day, v.visits,
      coalesce(e.equipment, 0)::integer as equipment
    from daily_visits v
    left join daily_equipment e using (day)
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'filterOptions', jsonb_build_object(
      'schools', coalesce((select jsonb_agg(to_jsonb(s) order by s.name, s.cie) from filter_schools s), '[]'::jsonb),
      'analysts', coalesce((select jsonb_agg(a.name order by a.name) from filter_analysts a), '[]'::jsonb)
    ),
    'totals', jsonb_build_object(
      'calls', (select count(distinct call_id)::integer from visit_rows),
      'visits', (select count(*)::integer from visit_rows),
      'equipment', (select count(*)::integer from latest_equipment),
      'schools', (select count(*)::integer from school_metrics),
      'analysts', (select count(*)::integer from analyst_metrics)
    ),
    'statuses', jsonb_build_array(
      jsonb_build_object('key', 'OK', 'label', 'OK', 'value', (select count(*)::integer from latest_equipment where equipment->>'status' = 'OK')),
      jsonb_build_object('key', 'NG_WITH_WARRANTY', 'label', 'NG com garantia', 'value', (select count(*)::integer from latest_equipment where equipment->>'status' = 'NG' and equipment->>'warranty' = 'SIM')),
      jsonb_build_object('key', 'NG_WITHOUT_WARRANTY', 'label', 'NG sem garantia', 'value', (select count(*)::integer from latest_equipment where equipment->>'status' = 'NG' and equipment->>'warranty' = 'NAO')),
      jsonb_build_object('key', 'UNSERVICEABLE', 'label', 'Inservível', 'value', (select count(*)::integer from latest_equipment where equipment->>'status' = 'INSERVÍVEL')),
      jsonb_build_object('key', 'REUSE', 'label', 'Reaproveitamento', 'value', (select count(*)::integer from latest_equipment where equipment->>'status' = 'REAPROVEITAMENTO'))
    ),
    'schools', coalesce((select jsonb_agg(to_jsonb(s) order by s.visits desc, s.equipment desc, s.name) from school_metrics s), '[]'::jsonb),
    'analysts', coalesce((select jsonb_agg(to_jsonb(a) order by a.visits desc, a.equipment desc, a.name) from analyst_metrics a), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.total desc, m.manufacturer, m.model) from model_metrics m), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.date) from daily_metrics d), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.sti_dashboard_metrics_filtered(date, date, text, text) from public, anon;
grant execute on function public.sti_dashboard_metrics_filtered(date, date, text, text) to authenticated;

commit;
