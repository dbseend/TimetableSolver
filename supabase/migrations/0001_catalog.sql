-- Course catalogs per semester. The app always loads a whole catalog, so each semester is one
-- row holding the Catalog JSON (validated by the backend's pydantic model on read).
create table public.semesters (
  id text primary key,                      -- e.g. 'synthetic-50', '2026-2'
  label text not null,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.catalogs (
  semester_id text primary key references public.semesters (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.semesters enable row level security;
alter table public.catalogs enable row level security;

-- Read-only public access: only synthetic catalogs are stored for now (docs/adr/0005).
-- Before loading real course data, replace these with backend-only access (secret key).
create policy "catalog read" on public.semesters for select to anon, authenticated using (true);
create policy "catalog read" on public.catalogs for select to anon, authenticated using (true);
