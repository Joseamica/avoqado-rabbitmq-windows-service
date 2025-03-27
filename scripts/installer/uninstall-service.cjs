// CommonJS version of uninstall-service.js
const { Service } = require('node-windows')
const path = require('path')
const fs = require('fs')
const { promises: fsPromises } = require('fs')

// __dirname is already available in CommonJS modules
const rootPath = path.join(__dirname, '..', '..')
const daemonPath = path.join(rootPath, 'src', 'daemon')

// Service setup with the same config as install-service.cjs to ensure we're working with the same service
const svc = new Service({
  name: 'avoqadorabbitmqservice',
  description: 'RabbitMQ to SQL Server communication service',
  script: path.join(rootPath, 'src', 'index.js'),
  nodeOptions: ['--no-warnings']
})

// Helper function to wait for a specific amount of time
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Helper function to check if service exists
const serviceExists = () =>
  new Promise((resolve) => {
    svc.exists ? resolve(true) : resolve(false)
  })

// Main uninstallation function
async function uninstallService() {
  try {
    console.log('Starting uninstallation process...')

    // Check if the service exists before trying to stop it
    if (svc.exists) {
      // Step 1: Stop the service
      console.log('Stopping service...')

      // Create a promise that resolves when the stop event is triggered
      const stopPromise = new Promise((resolve) => {
        svc.on('stop', () => {
          console.log('Service stopped successfully')
          resolve()
        })
      })

      // Attempt to stop the service
      svc.stop()

      // Wait for the service to stop with a timeout
      await Promise.race([stopPromise, sleep(30000).then(() => console.log('Waiting for service to stop... (timeout may occur if service is already stopped)'))])

      // Give a small delay to ensure service operations complete
      await sleep(2000)

      // Step 2: Uninstall the service
      console.log('Uninstalling service...')

      // Create a promise that resolves when the uninstall event is triggered
      const uninstallPromise = new Promise((resolve) => {
        svc.on('uninstall', () => {
          console.log('Service uninstalled successfully')
          resolve()
        })
      })

      // Attempt to uninstall the service
      svc.uninstall()

      // Wait for the service to uninstall with a timeout
      await Promise.race([uninstallPromise, sleep(30000).then(() => console.log('Waiting for service to uninstall... (timeout may occur if service is already uninstalled)'))])

      // Give a small delay to ensure service operations complete
      await sleep(3000)
    } else {
      console.log('Service does not exist or is already uninstalled')
    }

    // Step 3: Delete daemon directory files
    if (fs.existsSync(daemonPath)) {
      console.log('Removing daemon files...')
      try {
        // First check what files exist
        const daemonFiles = fs.readdirSync(daemonPath)
        console.log(`Found ${daemonFiles.length} files in daemon directory: ${daemonFiles.join(', ')}`)

        // Delete each file individually to ensure better error handling
        for (const file of daemonFiles) {
          const filePath = path.join(daemonPath, file)
          await fsPromises.rm(filePath, { force: true })
          console.log(`Deleted ${filePath}`)
        }

        console.log('All daemon files deleted successfully')
      } catch (error) {
        console.error('Error deleting daemon files:', error.message)
      }
    } else {
      console.log('Daemon directory does not exist')
    }

    console.log('Uninstallation process completed')
  } catch (error) {
    console.error('Uninstallation error:', error)
  }
}

// Run the uninstallation process
uninstallService()
