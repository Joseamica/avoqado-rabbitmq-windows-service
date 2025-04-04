// src/services/rabbitmq/publisher.js
import { getConnection, getChannel } from './consumer.js'
import { logInfo, logError, logDebug } from '../../utils/logger.js'

// Get venue ID from environment
const venueId = process.env.VENUE_ID || 'madre_cafecito'

// Queue names for different event types
const QUEUES = {
  TicketEvents: 'pos.tickets',
  ProductEvents: 'pos.products',
  PaymentEvents: 'pos.payments',
  TurnoEvents: 'pos.shifts'
}

// Exchange name
const POS_EVENTS_EXCHANGE = 'pos.events'

// Track initialization status
let isInitialized = false

// Confirm channel for publishing with confirms
let confirmChannel = null

// Initialize the publisher
export async function initPublisher() {
  if (isInitialized) {
    logDebug('Publisher already initialized')
    return true
  }

  try {
    const connection = getConnection()
    if (!connection) {
      throw new Error('RabbitMQ connection not available')
    }

    // Create a confirm channel for reliable publishing
    confirmChannel = await connection.createConfirmChannel()
    logDebug('Publisher confirm channel created')

    // Declare exchange
    await confirmChannel.assertExchange(POS_EVENTS_EXCHANGE, 'direct', { durable: true })

    // Declare queues and bind to exchange
    for (const [eventType, queueName] of Object.entries(QUEUES)) {
      await confirmChannel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': `${POS_EVENTS_EXCHANGE}.dlx`,
          'x-dead-letter-routing-key': `${queueName}.dead`
        }
      })
      await confirmChannel.bindQueue(queueName, POS_EVENTS_EXCHANGE, queueName)

      // Setup dead letter exchange and queue
      await confirmChannel.assertExchange(`${POS_EVENTS_EXCHANGE}.dlx`, 'direct', { durable: true })
      await confirmChannel.assertQueue(`${queueName}.dead`, { durable: true })
      await confirmChannel.bindQueue(`${queueName}.dead`, `${POS_EVENTS_EXCHANGE}.dlx`, `${queueName}.dead`)

      logInfo(`Queue ${queueName} configured with dead letter handling`)
    }

    isInitialized = true
    logInfo('RabbitMQ publisher initialized successfully')
    return true
  } catch (error) {
    logError(`Failed to initialize RabbitMQ publisher: ${error.message}`)
    return false
  }
}

/**
 * Publish an event to RabbitMQ
 * @param {string} eventType - The type of event (table name)
 * @param {object} data - The event data
 * @returns {Promise<boolean>} - Whether the publish was successful
 */
export async function publishEvent(eventType, data) {
  if (!isInitialized) {
    try {
      const initialized = await initPublisher()
      if (!initialized) {
        throw new Error('Publisher initialization failed')
      }
    } catch (error) {
      logError(`Failed to initialize publisher on demand: ${error.message}`)
      return false
    }
  }

  try {
    if (!confirmChannel) {
      throw new Error('RabbitMQ confirm channel not available')
    }

    // Map event type to queue name
    const routingKey = QUEUES[eventType]
    if (!routingKey) {
      throw new Error(`Unknown event type: ${eventType}`)
    }

    // Add metadata
    const messageId = generateMessageId()
    const enrichedData = {
      ...data,
      _metadata: {
        source: `POS-${process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown'}`,
        timestamp: new Date().toISOString(),
        eventType,
        messageId,
        venueId // Explicitly include venue ID in metadata
      }
    }

    // Serialize the message
    const message = Buffer.from(JSON.stringify(enrichedData))

    // Publish with publisher confirms
    return new Promise((resolve) => {
      confirmChannel.publish(
        POS_EVENTS_EXCHANGE,
        routingKey,
        message,
        {
          persistent: true,
          contentType: 'application/json',
          messageId,
          timestamp: Math.floor(Date.now() / 1000),
          headers: {
            'x-venue-id': venueId // Add venue ID as header for filtering
          }
        },
        (err, ok) => {
          if (err) {
            logError(`Error in confirm callback: ${err.message}`)
            resolve(false)
          } else {
            logDebug(`Published ${eventType} event to ${routingKey} with ID ${messageId} for venue: ${venueId}`)
            resolve(true)
          }
        }
      )
    })
  } catch (error) {
    logError(`Error publishing event: ${error.message}`)
    return false
  }
}

// Generate a unique message ID
function generateMessageId() {
  return `${venueId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

// Check if publisher is initialized
export function isPublisherInitialized() {
  return isInitialized
}

// Reset initialization status (useful for reconnection scenarios)
export function resetPublisherState() {
  isInitialized = false
  confirmChannel = null
  logInfo('Publisher state reset')
}

export default {
  initPublisher,
  publishEvent,
  isPublisherInitialized,
  resetPublisherState
}
