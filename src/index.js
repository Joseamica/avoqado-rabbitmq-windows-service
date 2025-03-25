// src/index.js - Main entry point
import 'dotenv/config'
import { createDbPool } from './config/database.js'
import { connectToRabbitMQ } from './services/rabbitmq/consumer.js'
import { initPublisher } from './services/rabbitmq/publisher.js'
import { setupChangeTracking, startChangeTracking, stopChangeTracking } from './services/database/change-tracking.js'
import { logInfo, logError } from './utils/logger.js'

// Global database pool
let pool
let isServiceRunning = false

async function startService() {
  try {
    if (isServiceRunning) {
      logInfo('Service is already running')
      return
    }

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

    // Setup change tracking
    await setupChangeTracking(pool, venueId)

    // Start change tracking to detect database changes
    startChangeTracking()

    logInfo('Service started successfully')
  } catch (error) {
    logError(`Error starting service: ${error.message}`)
    isServiceRunning = false

    // Attempt graceful restart after delay
    setTimeout(() => {
      logInfo('Attempting to restart service...')
      startService()
    }, 5000)
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  logInfo('Service shutdown initiated')

  // Stop change tracking
  stopChangeTracking()

  // Close database connection
  if (pool) {
    try {
      await pool.close()
      logInfo('Database connection closed')
    } catch (error) {
      logError(`Error closing database connection: ${error.message}`)
    }
  }

  process.exit(0)
})

// Start the service
startService()

// Export for Windows service
export default { startService }
