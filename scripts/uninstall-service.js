// scripts/uninstall-service.js
import { Service } from 'node-windows'
import path from 'path'
import { fileURLToPath } from 'url'

// Get directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Service setup with the same name as installation
const svc = new Service({
  name: 'AvoqadoRabbitMQService',
  script: path.join(__dirname, '../src/index.js')
})

// Listen for uninstall events
svc.on('uninstall', () => {
  console.log('Service uninstalled successfully!')
})

svc.on('error', (err) => {
  console.error('Uninstall error:', err)
})

// Uninstall service
console.log('Uninstalling service...')
svc.uninstall()
