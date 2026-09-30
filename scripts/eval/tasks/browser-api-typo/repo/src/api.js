/** Fetches the inventory list from the API. */
export async function loadItems(fetchImpl = fetch) {
  const response = await fetchImpl('/api/itemz')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  return body.items
}
