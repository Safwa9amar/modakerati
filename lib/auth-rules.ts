/**
 * Password policy, in one place.
 *
 * GoTrue's own floor is 6. This is stricter, which means it is OURS to enforce
 * and ours to explain — the server will happily accept a 6-character password,
 * so nothing but the app stops one. It lives here rather than in a screen
 * because three callers need the same number: the form that validates against
 * it, the sentence that states it, and the error text that repeats it.
 */
export const MIN_PASSWORD_LENGTH = 8;
