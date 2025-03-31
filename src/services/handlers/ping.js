// src/services/handlers/ping.js
import { getChannel } from '../rabbitmq/consumer.js'
import { logInfo } from '../../utils/logger.js'

/**
 * Handle PING operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 * @param {string} replyTo - Queue to reply to (if provided)
 */
export async function handlePing(data, correlationId, replyTo) {
  const venueId = process.env.VENUE_ID || 'madre_cafecito'
  const responseChannel = getChannel()

  try {
    const receivedTime = new Date()
    const pingTime = data.pingTime ? new Date(data.pingTime) : null

    const responseData = {
      venueId,
      status: 'ACTIVE',
      systemTime: receivedTime.toISOString(),
      pingReceived: receivedTime.toISOString(),
      pingResponseTime: pingTime ? receivedTime.getTime() - pingTime.getTime() : null,
      environment: process.env.NODE_ENV || 'production',
      hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
      serviceVersion: process.env.SERVICE_VERSION || 'unknown'
    }

    // If replyTo is provided, send the response to that queue
    if (replyTo) {
      await responseChannel.sendToQueue(replyTo, Buffer.from(JSON.stringify(responseData)), {
        correlationId,
        contentType: 'application/json'
      })

      logInfo(`Ping response sent directly to ${replyTo} with correlationId: ${correlationId}`)
    }
    // Otherwise, send through the normal response channel
    else {
      // Use regular response queue via the sendResponse function
      const responseQueue = `responses.${venueId}`

      await responseChannel.sendToQueue(
        responseQueue,
        Buffer.from(
          JSON.stringify({
            operation: 'PING_RESPONSE',
            data: responseData,
            correlationId,
            venueId,
            timestamp: new Date().toISOString()
          })
        ),
        {
          persistent: true,
          contentType: 'application/json'
        }
      )

      logInfo(`Ping response sent via standard channel with correlationId: ${correlationId}`)
    }

    return true
  } catch (error) {
    logInfo(`Error handling ping: ${error.message}`)
    throw error
  }
}

export default {
  handlePing
}
