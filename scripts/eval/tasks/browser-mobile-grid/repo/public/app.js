import { columnsForWidth } from '../src/layout.js'

const response = await fetch('/api/card')
const card = await response.json()
const layout = document.querySelector('#layout')
const cards = document.querySelector('#cards')

function renderLayout() {
  const columns = columnsForWidth(innerWidth)
  layout.textContent = `${innerWidth}px viewport · ${columns} columns`
  cards.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
}

const button = document.createElement('button')
button.textContent = card.title
button.addEventListener('click', () => { document.querySelector('#detail').textContent = `Reference ${card.reference}` })
cards.append(button)
addEventListener('resize', renderLayout)
renderLayout()
