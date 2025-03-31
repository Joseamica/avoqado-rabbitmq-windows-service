// CommonJS version of install-service.cjs
const { Service } = require('node-windows')
const path = require('path')
const fs = require('fs')
const os = require('os')

require('dotenv').config()

const isProduction = process.env.APP_IS_PACKAGED === 'true' || process.resourcesPath || process.env.NODE_ENV === 'production'
console.log('isProduction', isProduction)
const rootPath = isProduction ? path.join(__dirname, '..', '..') : path.join(__dirname, '..', '..')

// Set up paths

console.log('rootPath', rootPath)
// Create consistent configuration directory in AppData regardless of environment
const appDataConfigDir = path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service')
// At the top, right after requires

const envPath = isProduction
  ? path.join(appDataConfigDir, '.env') // Production: use AppData
  : path.join(rootPath, '.env') // Development: use project root

const createDirectoryIfNotExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      console.log(`Created directory: ${dirPath}`)
    } catch (err) {
      console.error(`Failed to create directory: ${err.message}`)
    }
  }
}
console.log('os.homedir()', os.homedir())
// Create necessary directories
createDirectoryIfNotExists(appDataConfigDir)
const logsDir = isProduction ? path.join(appDataConfigDir, 'logs') : path.join(rootPath, 'logs')
createDirectoryIfNotExists(logsDir)
const daemonPath = isProduction ? path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service', 'daemon') : path.join(rootPath, 'src', 'daemon')
createDirectoryIfNotExists(daemonPath)

if (!fs.existsSync(daemonPath)) {
  try {
    fs.mkdirSync(daemonPath, { recursive: true })
    console.log(`Created daemon directory: ${daemonPath}`)
  } catch (err) {
    console.error(`Error creating daemon directory: ${err.message}`)
    process.exit(1)
  }
}
process.env.WINSERVICED = isProduction ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'daemon') : path.join(rootPath, 'src', 'daemon')
const servicePath = isProduction ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'index.js') : path.join(rootPath, 'src', 'index.js')

console.log(`Using service path: ${servicePath}`)
console.log(`Using daemon path: ${daemonPath}`)

// Check if the service script exists
if (!fs.existsSync(servicePath)) {
  console.error(`Service script not found at: ${servicePath}`)
  console.error('Please make sure the application is installed correctly.')
  process.exit(1)
}

// Override node-windows daemon folder
console.log('WINSERVICED set to:', process.env.WINSERVICED)
console.log('daemonPath:', daemonPath)
// Service setup with proper paths
const svc = new Service({
  name: 'avoqadorabbitmqservice',
  description: 'Avoqado POS RabbitMQ to SQL Server communication service',
  script: servicePath,
  workingDirectory: rootPath,

  nodeOptions: ['--no-warnings'],
  env: {
    CONFIG_PATH: envPath
  },
  stopparentfirst: true,
  stoptimeout: 30,
  grow: 0.5,
  wait: 2,
  maxRetries: 3
})

// Listen for events
svc.on('install', () => {
  console.log('\n✅ Service installed successfully!')
  console.log('Avoqado POS Service Starting service...')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ Service started successfully!')
  console.log(`Configuration located at: ${path.join(appDataConfigDir, '.env')}`)
  console.log(`Service logs located at: ${logsDir}`)
})

svc.on('alreadyinstalled', () => {
  console.log('\n⚠️ Service is already installed.')
  console.log('Restarting service...')
  // First stop, then start to ensure fresh configuration is picked up
  svc.stop()
  svc.on('stop', () => {
    svc.start()
  })
})

svc.on('error', (err) => {
  console.error('\n❌ Service error:', err)
  if (err.toString().includes('permission')) {
    console.error('\nThis error is typically caused by insufficient permissions.')
    console.error('Please try running the installer as an Administrator.')
  }
})

// Try to install the service
console.log(`Installing service with script: ${servicePath}`)
console.log(`Using daemon folder: ${daemonPath}`)

// Check if service is already installed
if (svc.exists) {
  console.log('Service is already installed. Checking status...')
  svc.emit('alreadyinstalled')
} else {
  console.log('Installing service...')
  svc.install()
}
