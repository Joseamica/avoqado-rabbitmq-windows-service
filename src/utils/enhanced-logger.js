// src/utils/enhanced-logger.js
import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { exec } from 'child_process'
import * as os from 'os'
const isProduction = process.env.APP_IS_PACKAGED === 'true' || process.resourcesPath || process.env.NODE_ENV === 'production'

// 🔹 Solution for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths for logs
const logsDir = path.resolve(__dirname, '../../logs')
const serviceLogPath = path.join(logsDir, 'service')
const errorLogPath = path.join(logsDir, 'error')

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}


// Define the format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${stack ? '\n' + stack : ''}`
  })
)

// Create transports for different log files with rotation
const serviceTransport = new winston.transports.DailyRotateFile({
  filename: `${serviceLogPath}-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  level: 'info'
})

const errorTransport = new winston.transports.DailyRotateFile({
  filename: `${errorLogPath}-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error'
})

// Create console transport
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return `[${timestamp}] ${level}: ${message}${stack ? '\n' + stack : ''}`
    })
  )
})

// Create the logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [serviceTransport, errorTransport, consoleTransport],
  exitOnError: false
})

// Helper functions for compatibility with the existing logger interface
export function logError(message, error) {
  if (error) {
    logger.error(`${message}: ${error.message}`, { stack: error.stack })

    // Save to Windows Event Viewer
    if (os.platform() === 'win32' && isProduction) {
      exec(`eventcreate /ID 1 /L Application /T ERROR /SO "AvoqadoPOSService" /D "${message}: ${error.message.replace(/"/g, '\\"')}"`, (err) => {
        if (err) console.error('Error writing to Event Viewer:', err)
      })
    }
  } else {
    logger.error(message)

    // Save to Windows Event Viewer
    if (os.platform() === 'win32' && isProduction) {
      exec(`eventcreate /ID 1 /L Application /T ERROR /SO "AvoqadoPOSService" /D "${message.replace(/"/g, '\\"')}"`, (err) => {
        if (err) console.error('Error writing to Event Viewer:', err)
      })
    }
  }
}

export function logInfo(message) {
  logger.info(message)
}

export function logWarning(message) {
  logger.warn(message)
}

export function logDebug(message) {
  logger.debug(message)
}

// Export the winston logger for advanced usage
export const winstonLogger = logger

export default {
  logError,
  logInfo,
  logWarning,
  logDebug,
  winstonLogger
}
