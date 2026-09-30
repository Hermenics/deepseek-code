/** True for addresses like name@example.com. */
export function isValidEmail(email) {
  return /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(email)
}
