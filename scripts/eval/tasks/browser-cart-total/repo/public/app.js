import { cartTotal, formatMoney } from '../src/cart.js'

const response = await fetch('/api/cart')
const { items } = await response.json()
document.getElementById('items').innerHTML = items
  .map(item => `<li>${item.name} — ${item.quantity} × ${formatMoney(item.priceCents)}</li>`)
  .join('')
document.getElementById('total').textContent = `Total: ${formatMoney(cartTotal(items))}`
