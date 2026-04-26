-- Persons feature schema
-- Run once in Supabase SQL editor.

create table if not exists public.persons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists persons_user_created_idx
  on public.persons(user_id, created_at desc);

alter table public.persons enable row level security;

drop policy if exists "persons_select_own" on public.persons;
create policy "persons_select_own" on public.persons
for select using (auth.uid() = user_id);

drop policy if exists "persons_insert_own" on public.persons;
create policy "persons_insert_own" on public.persons
for insert with check (auth.uid() = user_id);

drop policy if exists "persons_update_own" on public.persons;
create policy "persons_update_own" on public.persons
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "persons_delete_own" on public.persons;
create policy "persons_delete_own" on public.persons
for delete using (auth.uid() = user_id);

alter table public.transactions
add column if not exists source_person_id uuid null references public.persons(id) on delete set null;

alter table public.transactions
add column if not exists target_person_id uuid null references public.persons(id) on delete set null;

create index if not exists transactions_source_person_idx
  on public.transactions(source_person_id)
  where source_person_id is not null;

create index if not exists transactions_target_person_idx
  on public.transactions(target_person_id)
  where target_person_id is not null;
