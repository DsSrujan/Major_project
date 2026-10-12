-- SQL Database Migration: Update Profiles Schema for Compulsory Name and Phone
-- Migration File: supabase/migrations/011_update_profiles_compulsory_info.sql
-- Description:
-- 1. Updates or creates public.profiles table linked to auth.users (id uuid primary key referencing auth.users.id).
-- 2. Ensures 'phone' is NOT the primary key (id is the single primary key).
-- 3. Adds columns: name (text), phone (text), email (text, optional), dob (date, optional), address (text, optional).
-- 4. Safely backfills legacy rows (from full_name / phone_number) without breaking existing data.
-- 5. Configures RLS policies and handles new user trigger safely for Google OAuth and Email signups.

-- 1. Create public.profiles if it does not already exist
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  name text,
  phone text,
  email text,
  dob date,
  address text,
  full_name text,
  phone_number text,
  user_role text DEFAULT 'Farmer',
  district text,
  state text,
  village text,
  preferred_language text DEFAULT 'English',
  organization_name text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add columns safely if table already existed (idempotent ALTERs)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dob date;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_role text DEFAULT 'Farmer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS village text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'English';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organization_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT timezone('utc'::text, now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT timezone('utc'::text, now());

-- 3. Verify and safeguard primary key: Ensure 'id' is the primary key and 'phone' is NOT the primary key
DO $$
BEGIN
  -- Confirm id is the primary key constraint on public.profiles
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'profiles'
      AND kcu.column_name = 'id'
  ) THEN
    ALTER TABLE public.profiles ADD PRIMARY KEY (id);
  END IF;
END $$;

-- 4. Safe Backfill for legacy rows:
-- Sync name from full_name if name is empty, and sync phone from phone_number if phone is empty
UPDATE public.profiles
SET name = COALESCE(NULLIF(name, ''), full_name, '')
WHERE name IS NULL OR name = '';

UPDATE public.profiles
SET phone = COALESCE(NULLIF(phone, ''), phone_number, '')
WHERE phone IS NULL OR phone = '';

-- Also keep full_name and phone_number populated for backward compatibility with legacy code
UPDATE public.profiles
SET full_name = COALESCE(NULLIF(full_name, ''), name, '')
WHERE full_name IS NULL OR full_name = '';

UPDATE public.profiles
SET phone_number = COALESCE(NULLIF(phone_number, ''), phone, '')
WHERE phone_number IS NULL OR phone_number = '';

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 6. Add or update RLS Policies safely
DO $$
BEGIN
  -- Select Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can select their own profile'
  ) THEN
    CREATE POLICY "Users can select their own profile" ON public.profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  -- Update Policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update their own profile'
  ) THEN
    CREATE POLICY "Users can update their own profile" ON public.profiles
      FOR UPDATE USING (auth.uid() = id);
  END IF;

  -- Insert Policy (permits upserts and new user inserts matching authenticated session)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert their own profile'
  ) THEN
    CREATE POLICY "Users can insert their own profile" ON public.profiles
      FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- 7. Trigger Function: Populate profile on new auth.users registration
-- Safely extracts metadata from OAuth (Google) and Email signups without failing when phone is initially null
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (
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
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'phone', new.raw_user_meta_data->>'phone_number', ''),
    new.email,
    CASE 
      WHEN new.raw_user_meta_data->>'dob' IS NOT NULL AND new.raw_user_meta_data->>'dob' <> '' 
      THEN (new.raw_user_meta_data->>'dob')::date 
      ELSE NULL 
    END,
    COALESCE(new.raw_user_meta_data->>'address', ''),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    COALESCE(new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'phone', ''),
    COALESCE(new.raw_user_meta_data->>'user_role', 'Farmer'),
    COALESCE(new.raw_user_meta_data->>'district', ''),
    COALESCE(new.raw_user_meta_data->>'state', ''),
    COALESCE(new.raw_user_meta_data->>'village', ''),
    COALESCE(new.raw_user_meta_data->>'preferred_language', 'English'),
    COALESCE(new.raw_user_meta_data->>'organization_name', ''),
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    name = CASE WHEN public.profiles.name IS NULL OR public.profiles.name = '' THEN EXCLUDED.name ELSE public.profiles.name END,
    phone = CASE WHEN public.profiles.phone IS NULL OR public.profiles.phone = '' THEN EXCLUDED.phone ELSE public.profiles.phone END,
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    updated_at = timezone('utc'::text, now());
  RETURN new;
END;
$$;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
