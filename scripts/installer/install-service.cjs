// CommonJS version of install-service.js
const { Service } = require('node-windows')
const path = require('path')

// __dirname is already available in CommonJS modules
const rootPath = path.join(__dirname, '..', '..')

// Service setup
const svc = new Service({
  name: 'avoqadorabbitmqservice',
  description: 'RabbitMQ to SQL Server communication service',
  script: path.join(rootPath, 'src', 'index.js'),
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
