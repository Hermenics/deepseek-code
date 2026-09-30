import { loadItems } from '../src/api.js'

const summary = document.getElementById('summary')
try {
  const items = await loadItems()
  summary.textContent = `${items.length} items in stock`
  document.getElementById('items').innerHTML = items.map(item => `<li>${item.sku} ${item.name}</li>`).join('')
} catch (error) {
  console.error('Inventory failed to load:', error.message)
  summary.textContent = 'Could not load the items.'
}
