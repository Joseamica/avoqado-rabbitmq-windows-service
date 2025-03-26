// CommonJS version of uninstall-service.js
const { Service } = require('node-windows')
const path = require('path')
const { execSync, spawn } = require('child_process')
const fs = require('fs')

// Check if running with admin privileges
function isAdmin() {
  try {
    // This command will fail if not running as administrator
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

// If not running as admin, elevate privileges
if (!isAdmin()) {
  console.log('Administrator privileges required for uninstallation.')
  console.log('Requesting elevation...')

  try {
    // Get the current script path
    const scriptPath = process.argv[1]

    // Create a PowerShell command to run the script elevated
    const psCommand = `
      Start-Process -FilePath "node" -ArgumentList "${scriptPath}" -Verb RunAs -Wait
    `

    // Execute the PowerShell command to request elevation
    const elevated = spawn('powershell.exe', ['-Command', psCommand], {
      detached: true,
      stdio: 'inherit'
    })

    elevated.on('exit', (code) => {
      if (code !== 0) {
        console.error('Failed to launch with admin privileges. Uninstallation may fail.')
        console.error('Please right-click and select "Run as administrator" manually.')
      } else {
        console.log('Uninstallation completed with elevated privileges.')
      }
      // Exit the non-elevated process
      process.exit(code || 0)
    })

    // Exit immediately after launching the elevated process
    console.log('Waiting for admin confirmation...')
    return
  } catch (err) {
    console.error('Error requesting elevation:', err.message)
    console.error('Please run this script with administrator privileges manually.')
    process.exit(1)
  }
}

console.log('Running with administrator privileges.')

// __dirname is already available in CommonJS modules
const rootPath = path.join(__dirname, '..', '..')

// Service setup with the same name as installation
const svc = new Service({
  name: 'AvoqadoRabbitMQService',
  script: path.join(rootPath, 'src', 'index.js'),
  wait: 2, // Wait time in seconds before force kill
  stopparentfirst: true
})

// First try to stop the service
console.log('Stopping service if running...')

// Patch the node-windows 'uninstall' method to avoid errors with missing daemon directory
// This is a monkey patch that helps avoid the ENOENT errors
const originalWrapperMethod = svc.wrapperModule.remove
if (originalWrapperMethod) {
  svc.wrapperModule.remove = function (serviceRoot, callback) {
    try {
      // Check if daemon directory exists before attempting to read from it
      const daemonDir = path.join(serviceRoot, 'daemon')
      if (!fs.existsSync(daemonDir)) {
        console.log(`Daemon directory not found: ${daemonDir}`)
        if (callback) callback()
        return
      }

      // If directory exists, call the original method
      originalWrapperMethod(serviceRoot, callback)
    } catch (err) {
      console.log(`Error during service cleanup: ${err.message}`)
      if (callback) callback(err)
    }
  }
}

// Function to handle uninstall with retry
function performUninstall() {
  let retryCount = 0
  const maxRetries = 3

  // Handle the actual uninstall
  function tryUninstall() {
    svc.on('uninstall', () => {
      console.log('Service uninstalled successfully!')

      // Try to clean up any remaining files
      try {
        const daemonDir = path.join(rootPath, 'src', 'daemon')
        if (fs.existsSync(daemonDir)) {
          console.log(`Checking for remaining files in ${daemonDir}...`)
        } else {
          console.log(`No daemon directory found at ${daemonDir}, cleanup is complete.`)
        }
      } catch (err) {
        console.log(`Note: Cleanup status check error: ${err.message}`)
        console.log('Some files may need to be manually removed after restart.')
      }
    })

    svc.on('error', (err) => {
      console.error('Uninstall error:', err?.message || err || 'Unknown error')

      // Retry logic for certain errors only
      const shouldRetry = !err?.message?.includes('ENOENT') || retryCount === 0

      if (retryCount < maxRetries && shouldRetry) {
        retryCount++
        console.log(`Retrying uninstall (attempt ${retryCount} of ${maxRetries})...`)
        // Give it a moment before retrying
        setTimeout(tryUninstall, 5000)
      } else {
        if (err?.message?.includes('ENOENT')) {
          console.log('Service files not found. It may already be uninstalled or partially removed.')
          console.log('You can consider the uninstallation complete.')
        } else {
          console.error('Maximum retry attempts reached. Please try the following:')
          console.error('1. Restart your computer')
          console.error('2. Run this script again with administrator privileges')
          console.error('3. Manually remove the service using Windows Service Manager')
          console.error('\nTo manually remove using Windows Service Manager:')
          console.error('- Open "Services" from Control Panel or Run "services.msc"')
          console.error('- Find "AvoqadoRabbitMQService", right-click and select "Stop" if running')
          console.error('- Right-click and select "Properties", change Startup Type to "Disabled"')
          console.error('- In Command Prompt (as admin), run: sc delete AvoqadoRabbitMQService')
        }
      }
    })

    // Attempt uninstall
    console.log('Uninstalling service...')
    svc.uninstall()
  }

  // Start the process
  tryUninstall()
}

// Try to stop the service first, then uninstall
svc.on('stop', () => {
  console.log('Service stopped successfully.')
  performUninstall()
})

// If the service isn't running or doesn't exist, just proceed with uninstall
svc.on('invalidinstallation', () => {
  const message = 'Service is not installed or could not be found on this system.'
  console.log(message)

  // Display information that no service was found, but mark as successful
  console.log('No uninstallation needed since service does not exist.')
  console.log('SUCCESS: No action needed - service is not installed')

  // Since there's no service to uninstall, we'll consider this a success
  // We don't need to call performUninstall() here since there's nothing to uninstall
  process.exit(0)
})

// Try to stop the service first
try {
  console.log('Attempting to stop service...')
  svc.stop()
} catch (err) {
  // If stopping fails (e.g., service doesn't exist), proceed with uninstall
  console.log('Could not stop service, proceeding with uninstall:', err.message)
  performUninstall()
}
