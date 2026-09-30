import { estimateDays } from '../src/shipping.js'

const response = await fetch('/api/quote')
const quote = await response.json()
const select = document.querySelector('#method')
for (const option of quote.options) select.add(new Option(option.label, option.id))

document.querySelector('#quote').addEventListener('click', () => {
  const days = estimateDays(quote.options, select.value)
  document.querySelector('#result').textContent = days === null
    ? 'Could not estimate delivery.'
    : `Arrival in ${days} business days · Shipment ${quote.reference}`
})
