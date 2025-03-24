// scripts/install-service.js
import { Service } from 'node-windows'
import path from 'path'
import { fileURLToPath } from 'url'

// Get directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Service setup
const svc = new Service({
  name: 'AvoqadoRabbitMQService',
  description: 'RabbitMQ to SQL Server communication service',
  script: path.join(__dirname, '../src/index.js'),
  nodeOptions: ['--no-warnings'],
  // Allow service to restart on failure
  grow: 0.5,
  wait: 2,
  maxRetries: 3
})

// Listen for events
svc.on('install', () => {
  console.log('Service installed successfully!')
  svc.start()
})

svc.on('start', () => {
  console.log('Service started successfully!')
})

svc.on('error', (err) => {
  console.error('Service error:', err)
})

// Check if service is already installed
if (!svc.exists) {
  console.log('Installing service...')
  svc.install()
} else {
  console.log('Service is already installed')
}
