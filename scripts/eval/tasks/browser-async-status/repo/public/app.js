import { formatJob } from '../src/job.js'

document.querySelector('#refresh').addEventListener('click', async () => {
  const status = document.querySelector('#status')
  status.textContent = 'Checking status…'
  const response = await fetch('/api/job')
  status.textContent = formatJob(await response.json())
})
