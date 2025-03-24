// src/services/rabbitmq/sender.js
import { RESPONSE_QUEUE } from '../../config/rabbitmq.js'
import { logError } from '../../utils/logger.js'
import { getChannel } from './consumer.js'

// Send response back to cloud backend
export async function sendResponse(operation, data, correlationId) {
  try {
    const channel = getChannel()

    if (!channel) {
      throw new Error('RabbitMQ channel not available')
    }

    const message = {
      operation,
      data,
      correlationId, // Include the correlation ID from the request
      timestamp: new Date().toISOString()
    }

    await channel.sendToQueue(RESPONSE_QUEUE, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      // Adding message properties with correlationId for additional reliability
      messageProperties: {
        correlationId: correlationId
      }
    })

    console.log(`Response sent to ${operation} with correlationId: ${correlationId}`)
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
