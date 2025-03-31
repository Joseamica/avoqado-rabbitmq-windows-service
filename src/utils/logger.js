import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import * as os from 'os'
try {
  fs.appendFileSync('C:/avoqado-startup.log', `Logger initialization started at ${new Date().toISOString()}\n`)
} catch (e) {
  // Can't do much if even this fails
}
// 🔹 Solution for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Check if running in production
const isProduction = process.env.APP_IS_PACKAGED === 'true' || process.resourcesPath || process.env.NODE_ENV === 'production'

// Set the logs directory to match install-service.cjs
let logFilePath
if (isProduction) {
  // Use AppData/Roaming where your service is already configured to use
  const appDataConfigDir = path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service')
  const logsDir = path.join(appDataConfigDir, 'logs')
  logFilePath = path.join(logsDir, 'service.log')
} else {
  // Development environment - use project directory
  const rootPath = path.resolve(__dirname, '../..')
  logFilePath = path.join(rootPath, 'logs', 'service.log')
}

// Create logs directory if it doesn't exist
const logsDir = path.dirname(logFilePath)
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

console.log('Log file path:', logFilePath)

// Function to write logs - with improved Windows Event Viewer support
export function logError(message) {
  try {
    // Log to a location that should definitely be writable
    const emergencyLogPath = path.join(os.homedir(), 'avoqado-emergency.log')
    fs.appendFileSync(emergencyLogPath, `[${new Date().toISOString()}] ERROR: ${message}\n`)

    // Try PowerShell for event log (with maximum error reporting)
    if (os.platform() === 'win32') {
      const psCommand = `powershell -Command "Write-EventLog -LogName Application -Source 'AvoqadoPOSService' -EntryType Error -EventId 1001 -Message '${message.replace(/'/g, "''")}'"`

      const result = require('child_process').execSync(psCommand, { encoding: 'utf8' })
      fs.appendFileSync(emergencyLogPath, `Event log result: ${result}\n`)
    }
  } catch (error) {
    // Last resort - write to a very accessible location
    try {
      fs.appendFileSync('C:/avoqado-critical.log', `[${new Date().toISOString()}] CRITICAL ERROR IN LOGGER: ${error.message}\n` + `Original message: ${message}\n`)
    } catch (e) {
      // At this point we can't do much more
    }
  }
}

export function logInfo(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] INFO: ${message}\n`
  console.log(logMessage)
  try {
    fs.appendFileSync(logFilePath, logMessage)
    // Add informational events to Event Viewer too
    if (os.platform() === 'win32') {
      // Use /T INFORMATION for info type, /ID 1000 for Info ID
      exec(`eventcreate /ID 1000 /L Application /T INFORMATION /SO "AvoqadoPOSService" /D "${message.replace(/"/g, '\\"')}"`, (err) => {
        if (err) console.error('Error writing to Event Viewer:', err)
      })
    }
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

export function logWarning(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] WARNING: ${message}\n`
  console.warn(logMessage)
  try {
    fs.appendFileSync(logFilePath, logMessage)
    // Add warning events to Event Viewer
    if (os.platform() === 'win32') {
      // Use /T WARNING for warning type, /ID 1002 for Warning ID
      exec(`eventcreate /ID 1002 /L Application /T WARNING /SO "AvoqadoPOSService" /D "${message.replace(/"/g, '\\"')}"`, (err) => {
        if (err) console.error('Error writing to Event Viewer:', err)
      })
    }
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

export function logDebug(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] DEBUG: ${message}\n`
  console.debug(logMessage)
  // Debug messages only go to console and file, not Event Viewer
  try {
    fs.appendFileSync(logFilePath, logMessage)
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

export default {
  logError,
  logInfo,
  logWarning,
  logDebug
}
