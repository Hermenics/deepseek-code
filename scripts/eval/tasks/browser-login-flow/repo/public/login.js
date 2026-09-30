import { loginRequest } from '../src/auth.js'

document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault()
  const response = await fetch('/api/login', loginRequest(document.getElementById('team').value.trim()))
  if (response.ok) location.href = '/public/dashboard.html'
  else document.getElementById('error').textContent = 'Login failed: ' + (await response.json()).error
})
