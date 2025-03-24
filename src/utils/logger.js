// src/utils/logger.js
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import * as os from 'os'

// 🔹 Solution for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to log file
const logFilePath = path.resolve(__dirname, '../../logs/service.log')

// Create logs directory if it doesn't exist
const logsDir = path.dirname(logFilePath)
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

console.log('Log file path:', logFilePath)

// Function to write logs
export function logError(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ERROR: ${message}\n`
  console.error(logMessage)

  try {
    fs.appendFileSync(logFilePath, logMessage)

    // Save to Windows Event Viewer
    if (os.platform() === 'win32') {
      exec(`eventcreate /ID 1 /L Application /T ERROR /SO "AvoqadoNodeService" /D "${message}"`, (err) => {
        if (err) console.error('Error writing to Event Viewer:', err)
      })
    }
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

export function logInfo(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] INFO: ${message}\n`
  console.log(logMessage)

  try {
    fs.appendFileSync(logFilePath, logMessage)
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
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

export default {
  logError,
  logInfo,
  logWarning
}
