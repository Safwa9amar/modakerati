-- Carry the student's institution from signup through to their profile.
--
-- Why this exists: signup.tsx collected a university into component state and
-- then threw it away — handle_new_user only copied full_name and email out of
-- raw_user_meta_data, so the answer never reached the database. A student had
-- to re-enter it later before anything could be matched to their institution.
--
-- profiles.university_id is the foreign key the server's starting-point
-- resolver joins on; the free-text `university` is kept alongside it as a
-- display value and as a fallback for institutions outside the catalogue.
--
-- The column itself is created by the server's ensureSchema() (which is the
-- authoritative runtime migration path). ADD COLUMN IF NOT EXISTS here keeps
-- this file self-sufficient for a database built from migrations alone.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS university_id uuid;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, university, university_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    NULLIF(NEW.raw_user_meta_data->>'university', ''),
    -- Guarded cast: a malformed or absent value must not break account
    -- creation. A null here simply means the app asks for the institution
    -- later, which it already handles.
    CASE
      WHEN NEW.raw_user_meta_data->>'university_id' ~ '^[0-9a-fA-F-]{36}$'
        THEN (NEW.raw_user_meta_data->>'university_id')::uuid
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition is unchanged; recreated so a fresh database gets it either way.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
