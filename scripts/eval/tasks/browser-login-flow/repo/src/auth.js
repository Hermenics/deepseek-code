/** fetch() options for the login request. */
export function loginRequest(teamCode) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamCode }) }
}
