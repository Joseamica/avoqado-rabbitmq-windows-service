// src/services/handlers/waiters.js
import { createDbPool } from '../../config/database.js'
import { sendResponse } from '../rabbitmq/index.js'
import { logError } from '../../utils/logger.js'

let pool

// Initialize database pool
async function initPool() {
  if (!pool) {
    pool = await createDbPool()
  }
  return pool
}

/**
 * Handle REQUEST_WAITERS operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handleGetWaiters(data, correlationId) {
  const { venueId } = data

  // Validate required parameters
  if (!venueId) {
    return await sendResponse(
      'REQUEST_WAITERS_ERROR',
      {
        function: 'requestWaiters',
        error: 'Missing venue id'
      },
      correlationId
    )
  }

  try {
    pool = await initPool()

    // Use direct query without transaction since this is a read operation
    const result = await pool.request().input('venueId', venueId) // Use proper SQL parameter
      .query(`
        SELECT 
          idmeserointerno, 
          idmesero, 
          nombre, 
          tipo, 
          visible, 
          perfil,
          contraseña
        FROM meseros
      `)

    await sendResponse(
      'RESPONSE_WAITERS',
      {
        venueId,
        data: result.recordset
      },
      correlationId
    )

    // Log only in development environment
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Sent ${result.recordset.length} waiters for venue ${venueId} with correlationId: ${correlationId}`)
    }
  } catch (error) {
    // Log error with structured information
    logError(`Error in requestWaiters handler: ${error.message}`)
    console.error('Error in requestWaiters handler:', {
      venueId,
      error: error.message,
      correlationId,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    })

    await sendResponse(
      'REQUEST_WAITERS_ERROR',
      {
        function: 'requestWaiters',
        venueId,
        error: error.message
      },
      correlationId
    )
  }
}

export default {
  handleGetWaiters
}
