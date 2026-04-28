-- Extensions
create extension if not exists pgcrypto;

-- Role system
create type public.app_role as enum ('admin', 'moderator', 'user');

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role = _role
  );
$$;

-- App tables
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  email text not null unique,
  full_name text,
  avatar_url text,
  preferred_language text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',
  current_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pdf_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  bucket_name text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  page_count int,
  is_ocr_processed boolean not null default false,
  processing_status text not null default 'uploaded',
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number int not null,
  pdf_file_id uuid references public.pdf_files(id) on delete set null,
  change_summary text,
  created_by_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pdf_file_id uuid not null references public.pdf_files(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  page_number int not null,
  annotation_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  label text not null,
  signature_type text not null,
  bucket_name text,
  storage_path text,
  svg_data text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  plan_code text not null,
  status text not null,
  billing_provider text,
  provider_customer_id text,
  provider_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Timestamp automation
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists trg_pdf_files_updated_at on public.pdf_files;
create trigger trg_pdf_files_updated_at
before update on public.pdf_files
for each row execute function public.set_updated_at();

drop trigger if exists trg_annotations_updated_at on public.annotations;
create trigger trg_annotations_updated_at
before update on public.annotations
for each row execute function public.set_updated_at();

drop trigger if exists trg_signatures_updated_at on public.signatures;
create trigger trg_signatures_updated_at
before update on public.signatures
for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- Indexes
create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_projects_owner_user_id on public.projects(owner_user_id);
create index if not exists idx_projects_updated_at on public.projects(updated_at desc);
create index if not exists idx_pdf_files_project_id on public.pdf_files(project_id);
create index if not exists idx_pdf_files_owner_user_id on public.pdf_files(owner_user_id);
create index if not exists idx_pdf_files_status on public.pdf_files(processing_status);
create index if not exists idx_project_versions_project_id on public.project_versions(project_id);
create index if not exists idx_annotations_project_id on public.annotations(project_id);
create index if not exists idx_annotations_pdf_file_id on public.annotations(pdf_file_id);
create index if not exists idx_signatures_owner_user_id on public.signatures(owner_user_id);
create index if not exists idx_subscriptions_owner_user_id on public.subscriptions(owner_user_id);
create index if not exists idx_activity_logs_owner_user_id on public.activity_logs(owner_user_id);
create index if not exists idx_activity_logs_project_id on public.activity_logs(project_id);
create index if not exists idx_activity_logs_created_at on public.activity_logs(created_at desc);

-- RLS enable
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.pdf_files enable row level security;
alter table public.project_versions enable row level security;
alter table public.annotations enable row level security;
alter table public.signatures enable row level security;
alter table public.subscriptions enable row level security;
alter table public.activity_logs enable row level security;

-- Helper function for mapping auth.uid() -> app user id
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

-- Users policies
create policy "Users can view own profile"
on public.users
for select
to authenticated
using (auth.uid() = auth_user_id or public.has_role(auth.uid(), 'admin'));

create policy "Users can create own profile"
on public.users
for insert
to authenticated
with check (auth.uid() = auth_user_id);

create policy "Users can update own profile"
on public.users
for update
to authenticated
using (auth.uid() = auth_user_id or public.has_role(auth.uid(), 'admin'))
with check (auth.uid() = auth_user_id or public.has_role(auth.uid(), 'admin'));

-- user_roles policies
create policy "Users can view own roles"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "Admins manage roles"
on public.user_roles
for all
to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- Generic owner-or-admin policies
create policy "Projects owner access"
on public.projects
for all
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "PDF files owner access"
on public.pdf_files
for all
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "Project versions owner access"
on public.project_versions
for all
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_versions.project_id
      and (p.owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_versions.project_id
      and (p.owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
  )
);

create policy "Annotations owner access"
on public.annotations
for all
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "Signatures owner access"
on public.signatures
for all
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "Subscriptions owner access"
on public.subscriptions
for all
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'))
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "Activity logs owner read"
on public.activity_logs
for select
to authenticated
using (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

create policy "Activity logs owner insert"
on public.activity_logs
for insert
to authenticated
with check (owner_user_id = public.current_app_user_id() or public.has_role(auth.uid(), 'admin'));

-- Auto-profile trigger on signup
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (auth_user_id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (auth_user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Storage buckets
insert into storage.buckets (id, name, public)
values ('pdf-files', 'pdf-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pdf-images', 'pdf-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

-- Storage RLS policies (owner folder = auth.uid())
create policy "Users can read own pdf files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'pdf-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can upload own pdf files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pdf-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update own pdf files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pdf-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own pdf files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pdf-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can read own pdf images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'pdf-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can upload own pdf images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pdf-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update own pdf images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pdf-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own pdf images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pdf-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can read own signatures"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'signatures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can upload own signatures"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'signatures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update own signatures"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'signatures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own signatures"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'signatures'
  and auth.uid()::text = (storage.foldername(name))[1]
);