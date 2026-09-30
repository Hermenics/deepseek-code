import { isValidEmail } from '../src/validate.js'

const message = document.getElementById('message')
document.getElementById('signup').addEventListener('submit', async event => {
  event.preventDefault()
  const email = document.getElementById('email').value.trim()
  if (!isValidEmail(email)) {
    message.textContent = 'Please enter a valid email address.'
    return
  }
  const response = await fetch('/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  const body = await response.json()
  message.textContent = response.ok ? `Welcome! Your confirmation code is ${body.code}.` : `Sign-up failed: ${body.error}`
})
