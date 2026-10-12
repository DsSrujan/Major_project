-- SQL Database Migration: Create Profiles Table and Trigger Logic
-- File Location: supabase/migrations/001_create_profiles.sql

-- Create public.profiles table linking to auth.users
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  name text,
  phone text,
  email text,
  dob date,
  address text,
  full_name text,
  phone_number text,
  user_role text default 'Farmer',
  district text,
  state text,
  village text,
  preferred_language text default 'English',
  organization_name text,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS) on public.profiles
alter table public.profiles enable row level security;

-- Add RLS Policies
create policy "Users can select their own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "Users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Trigger Function: Auto-populate profile on new auth.users registration
create or replace function public.handle_new_user()
returns trigger
security definer set search_path = public
language plpgsql
as $$
begin
  insert into public.profiles (
    id,
    name,
    phone,
    email,
    dob,
    address,
    full_name,
    phone_number,
    user_role,
    district,
    state,
    village,
    preferred_language,
    organization_name,
    is_active
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', new.raw_user_meta_data->>'phone_number', ''),
    new.email,
    case 
      when new.raw_user_meta_data->>'dob' is not null and new.raw_user_meta_data->>'dob' <> '' 
      then (new.raw_user_meta_data->>'dob')::date 
      else null 
    end,
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'user_role', 'Farmer'),
    coalesce(new.raw_user_meta_data->>'district', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'village', ''),
    coalesce(new.raw_user_meta_data->>'preferred_language', 'English'),
    coalesce(new.raw_user_meta_data->>'organization_name', ''),
    true
  )
  on conflict (id) do update set
    name = case when public.profiles.name is null or public.profiles.name = '' then excluded.name else public.profiles.name end,
    phone = case when public.profiles.phone is null or public.profiles.phone = '' then excluded.phone else public.profiles.phone end,
    email = coalesce(excluded.email, public.profiles.email),
    updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

-- Trigger: Execute procedure after successful entry in auth.users
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
