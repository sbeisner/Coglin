/**
 * The password rules, in one place.
 *
 * `MIN_PASSWORD` was declared separately in `Signup.tsx` and `AcceptInvite.tsx`
 * and again in `worker/routes/auth.ts`, and password recovery adds two more
 * screens that need it. The server copy is still the one that decides — this is
 * for telling somebody the rule before they submit, not for enforcing it.
 *
 * The mismatch check was copy-pasted verbatim between the two existing screens,
 * which is the other half of why this file exists.
 */
export const MIN_PASSWORD = 8;

/**
 * What is wrong with this pair, in words a student can act on, or null when
 * nothing is. Returns the first problem rather than a list: somebody fixing one
 * short password does not need to be told about the confirm field as well.
 */
export function passwordProblem(
  password: string,
  confirm: string,
): string | null {
  if (password.length < MIN_PASSWORD)
    return `Passwords need to be at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
