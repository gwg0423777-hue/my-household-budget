-- 나의 가계부 Phase 5: PC/모바일 계정 동기화용 테이블
-- 연결된 household-budget Supabase 프로젝트에는 2026-09-18 기준 이미 적용되어 있습니다.
-- 새 Supabase 프로젝트로 이전할 때만 이 SQL을 실행하세요.

create table if not exists public.household_budget_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.household_budget_data enable row level security;

drop policy if exists "budget_select_own" on public.household_budget_data;
drop policy if exists "budget_insert_own" on public.household_budget_data;
drop policy if exists "budget_update_own" on public.household_budget_data;
drop policy if exists "budget_delete_own" on public.household_budget_data;

create policy "budget_select_own" on public.household_budget_data
  for select to authenticated using (auth.uid() = user_id);
create policy "budget_insert_own" on public.household_budget_data
  for insert to authenticated with check (auth.uid() = user_id);
create policy "budget_update_own" on public.household_budget_data
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "budget_delete_own" on public.household_budget_data
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.household_budget_data to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'household_budget_data'
  ) then
    execute 'alter publication supabase_realtime add table public.household_budget_data';
  end if;
end $$;
