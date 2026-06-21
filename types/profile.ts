// Academic level — must match the DB CHECK constraint on profiles.level
// (see supabase/migrations/001_initial_schema.sql).
export const LEVELS = ["license", "master", "doctorat"] as const;
export type Level = (typeof LEVELS)[number];

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  university: string | null;
  department: string | null;
  level: Level | null;
  academicYear: string | null;
  avatarUrl: string | null;
  language: string | null;
  theme: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// The subset of fields the Edit Profile form is allowed to change. Email lives
// in auth.users (the profiles.email copy is denormalized) so it is not editable
// here.
export type ProfileUpdate = Partial<
  Pick<Profile, "fullName" | "university" | "department" | "level" | "academicYear" | "avatarUrl">
>;
