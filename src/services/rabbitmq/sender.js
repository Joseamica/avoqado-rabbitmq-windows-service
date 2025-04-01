// src/services/rabbitmq/sender.js
import { getChannel } from './consumer.js'
import { logError, logInfo } from '../../utils/logger.js'

// Get venue ID from environment
const venueId = process.env.VENUE_ID || 'madre_cafecito'

// Send response back to cloud backend
export async function sendResponse(operation, data, correlationId) {
  try {
    const channel = getChannel()

    if (!channel) {
      throw new Error('RabbitMQ channel not available')
    }

    // Use venue-specific response queue
    const responseQueue = `responses.${venueId}`

    const message = {
      operation,
      data,
      correlationId,
      venueId, // Include venue ID in response
      timestamp: new Date().toISOString()
    }

    await channel.sendToQueue(responseQueue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      headers: {
        'x-venue-id': venueId
      }
    })

    logInfo(`Response sent to ${operation} with correlationId: ${correlationId} for venue: ${venueId}`)
  } catch (error) {
    logError(`Error sending response: ${error.message}`)
    console.error('Failed to send response:', {
      operation,
      correlationId,
      error: error.message
    })
  }
}

export default {
  sendResponse
}
