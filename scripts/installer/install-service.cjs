// CommonJS version of install-service.js
const { Service } = require('node-windows')
const path = require('path')
const fs = require('fs')

// __dirname is already available in CommonJS modules
const rootPath = path.join(__dirname, '..', '..')
const daemonPath = path.join(rootPath, 'src', 'daemon')

// Ensure daemon directory exists before node-windows tries to use it
console.log(`Checking daemon directory: ${daemonPath}`)
try {
  // First ensure src directory exists
  const srcPath = path.join(rootPath, 'src')
  if (!fs.existsSync(srcPath)) {
    console.log(`Creating src directory: ${srcPath}`)
    fs.mkdirSync(srcPath, { recursive: true })
  }

  // Then create daemon directory
  if (!fs.existsSync(daemonPath)) {
    console.log(`Creating daemon directory: ${daemonPath}`)
    fs.mkdirSync(daemonPath, { recursive: true })
  }
} catch (err) {
  console.error(`Error creating daemon directory: ${err.message}`)
  process.exit(1)
}

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
