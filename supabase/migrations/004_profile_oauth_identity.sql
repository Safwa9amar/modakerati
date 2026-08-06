-- Make handle_new_user work for OAuth sign-ins, and repair accounts created
-- while it was absent.
--
-- Why this exists: this trigger is defined ONLY in these app-repo migrations.
-- The server's ensureSchema() — the authoritative runtime path, and how the
-- cloud project janzgpfnjzihelcwmkkg was provisioned — never creates it. So
-- cloud had no on_auth_user_created at all and NO account of any kind, Google
-- or email, ever received a profiles row: GET /api/user/profile 404'd and the
-- app rendered a blank Edit Profile. Applied to cloud on 2026-08-04; this file
-- is the record of what was run and what a fresh database still needs.
--
-- Three changes beyond 003:
--   * reads Google's raw claims (name / picture) as well as GoTrue's mirrored
--     copies (full_name / avatar_url), so OAuth accounts arrive with a name
--   * copies avatar_url at all, which 003 omits
--   * ON CONFLICT DO NOTHING, so an existing row can never make the INSERT
--     raise and abort account creation itself
--
-- search_path is pinned because the function is SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, university, university_id)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      ''
    ),
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
      NULLIF(NEW.raw_user_meta_data->>'picture', '')
    ),
    NULLIF(NEW.raw_user_meta_data->>'university', ''),
    -- Guarded cast: a malformed value must not break account creation.
    CASE
      WHEN NEW.raw_user_meta_data->>'university_id' ~ '^[0-9a-fA-F-]{36}$'
        THEN (NEW.raw_user_meta_data->>'university_id')::uuid
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Repair: give every pre-existing auth user the row it never got. Same column
-- mapping as the trigger, so a backfilled row is indistinguishable from one the
-- trigger would have written.
INSERT INTO public.profiles (id, full_name, email, avatar_url, university, university_id)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    ''
  ),
  COALESCE(u.email, ''),
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(u.raw_user_meta_data->>'picture', '')
  ),
  NULLIF(u.raw_user_meta_data->>'university', ''),
  CASE
    WHEN u.raw_user_meta_data->>'university_id' ~ '^[0-9a-fA-F-]{36}$'
      THEN (u.raw_user_meta_data->>'university_id')::uuid
    ELSE NULL
  END
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Rows that predate the avatar/name mapping: fill ONLY what is blank, so a
-- field the student deliberately cleared is never written back over.
UPDATE public.profiles p
SET
  full_name = COALESCE(
    NULLIF(p.full_name, ''),
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    ''
  ),
  email = COALESCE(NULLIF(p.email, ''), u.email, ''),
  avatar_url = COALESCE(
    p.avatar_url,
    NULLIF(u.raw_user_meta_data->>'avatar_url', ''),
    NULLIF(u.raw_user_meta_data->>'picture', '')
  ),
  updated_at = now()
FROM auth.users u
WHERE u.id = p.id
  AND (p.full_name = '' OR p.email = '' OR p.avatar_url IS NULL);
