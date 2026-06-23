// P0: The thesis store is now server-backed — theses are created via the API
// (POST /api/thesis) and hydrated with setTheses/upsertThesis, not seeded
// locally. The old client-side sample seeding relied on store.createThesis /
// updateThesis / the old chapter nesting, all of which were removed in the
// sections(top)->chapters(content) restructure. This is now a no-op (it has no
// callers); it can be rebuilt against the new model in the P2/P3 work if needed.
export function loadSampleData() {
  // intentionally empty
}
