// src/index.js - Main entry point with improved error handling and recovery
import 'dotenv/config'
import { createDbPool } from './config/database.js'
import { connectToRabbitMQ } from './services/rabbitmq/consumer.js'
import { initPublisher } from './services/rabbitmq/publisher.js'
import { setupChangeTracking, startChangeTracking, stopChangeTracking } from './services/database/change-tracking.js'
import { logInfo, logError, logWarning } from './utils/enhanced-logger.js'

// Global database pool
let pool
let isServiceRunning = false
let recoveryAttempts = 0
const MAX_RECOVERY_ATTEMPTS = 10
const INITIAL_RECOVERY_DELAY = 5000 // 5 seconds
let currentRecoveryDelay = INITIAL_RECOVERY_DELAY

async function startService() {
  try {
    if (isServiceRunning) {
      logInfo('Service is already running')
      return
    }

    logInfo('Starting Avoqado POS Sync Service')
    isServiceRunning = true

    // Connect to database
    pool = await createDbPool()
    logInfo('Database connection established')

    // Connect to RabbitMQ for consuming messages from cloud
    await connectToRabbitMQ()
    logInfo('RabbitMQ consumer connection established')

    // Initialize RabbitMQ publisher for sending messages to cloud
    await initPublisher()
    logInfo('RabbitMQ publisher initialized')

    // Get venue ID from environment or config
    const venueId = process.env.VENUE_ID || 'madre_cafecito'
    logInfo(`Service configured for venue: ${venueId}`)

    // Setup change tracking
    await setupChangeTracking(pool, venueId)

    // Start change tracking to detect database changes
    startChangeTracking()

    logInfo('Service started successfully')

    // Reset recovery metrics on successful start
    recoveryAttempts = 0
    currentRecoveryDelay = INITIAL_RECOVERY_DELAY
  } catch (error) {
    logError(`Error starting service: ${error.message}`, error)
    isServiceRunning = false

    // Implement exponential backoff for retry
    recoveryAttempts++

    if (recoveryAttempts <= MAX_RECOVERY_ATTEMPTS) {
      // Exponential backoff with jitter
      const jitter = Math.random() * 1000
      currentRecoveryDelay = Math.min(currentRecoveryDelay * 1.5, 60000) + jitter

      logWarning(`Attempt ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}: Service will restart in ${Math.round(currentRecoveryDelay / 1000)} seconds`)

      setTimeout(() => {
        logInfo('Attempting to restart service...')
        startService()
      }, currentRecoveryDelay)
    } else {
      logError(`Maximum recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached. Service will not automatically restart.`)
      logError('Please check logs, fix the issue, and restart the service manually.')

      // If running as a Windows service, this will cause the service to show as "stopped"
      // which will alert administrators
      process.exit(1)
    }
  }
}

// Handle graceful shutdown
async function shutdownGracefully(signal) {
  logInfo(`Service shutdown initiated (${signal})`)

  // Stop change tracking
  stopChangeTracking()

  // Close database connection
  if (pool) {
    try {
      await pool.close()
      logInfo('Database connection closed')
    } catch (error) {
      logError(`Error closing database connection: ${error.message}`, error)
    }
  }

  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    logWarning('Forcing service exit after timeout')
    process.exit(0)
  }, 10000) // 10 seconds

  // Clear the timeout if we exit normally
  forceExitTimeout.unref()

  process.exit(0)
}

// Handle process termination
process.on('SIGINT', () => shutdownGracefully('SIGINT'))
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError('Uncaught exception in service', error)

  // Attempt recovery if possible, or exit after cleanup
  if (isServiceRunning) {
    isServiceRunning = false

    // Attempt cleanup
    stopChangeTracking()

    if (pool) {
      pool.close().catch((err) => {
        logError(`Error closing database pool during exception handler: ${err.message}`, err)
      })
    }

    // Restart service after delay
    setTimeout(() => {
      logInfo('Attempting to restart service after uncaught exception...')
      startService()
    }, 5000)
  } else {
    // If we're not running yet, just exit
    process.exit(1)
  }
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Promise Rejection: ${reason}`, reason instanceof Error ? reason : new Error(String(reason)))
  // Don't exit; let the normal error handling in the application deal with it
})

// Health check function that can be called externally
export function checkHealth() {
  return {
    isRunning: isServiceRunning,
    dbConnected: !!pool,
    recoveryAttempts,
    startTime: process.uptime()
  }
}

// Start the service
startService()

// Export for Windows service
export default { startService, checkHealth }
