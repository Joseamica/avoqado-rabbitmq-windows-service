// src/index.js - Main entry point
import 'dotenv/config'
import { createDbPool } from './config/database.js'
import { connectToRabbitMQ } from './services/rabbitmq/index.js'
import { logInfo, logError } from './utils/logger.js'

// Global database pool
let pool

async function startService() {
  try {
    // Connect to database
    pool = await createDbPool()
    logInfo('Database connection established')

    // Connect to RabbitMQ
    await connectToRabbitMQ()
    logInfo('RabbitMQ connection established')

    logInfo('Service started successfully')
  } catch (error) {
    logError(`Error starting service: ${error.message}`)

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
