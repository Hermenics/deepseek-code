import { sortQueue } from '../src/queue.js'

const response = await fetch('/api/queue')
const { rows } = await response.json()
const list = document.querySelector('#tickets')
let visible = rows

function render() {
  list.replaceChildren(...visible.map(({ ref, score }) => {
    const item = document.createElement('li')
    item.textContent = `${ref} — score ${score}`
    return item
  }))
}

document.querySelector('#sort').addEventListener('click', () => {
  visible = sortQueue(visible)
  document.querySelector('#status').textContent = 'Sorted by score ascending'
  render()
})
render()
