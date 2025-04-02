// src/services/rabbitmq/consumer.js
import amqp from 'amqplib'
import { RABBITMQ_URL } from '../../config/rabbitmq.js'
import { logInfo, logError, logDebug } from '../../utils/logger.js'
import * as handlers from '../handlers/index.js'
import { resetPublisherState } from './publisher.js'

// Venues exchange
const VENUES_EXCHANGE = 'venues.exchange'

// Variables for RabbitMQ connection
let connection, channel
let venueId = process.env.VENUE_ID || 'madre_cafecito'

// Flag to track connection status
let isConnecting = false

// Connect to RabbitMQ
export async function connectToRabbitMQ() {
  if (isConnecting) {
    logDebug('Already attempting to connect to RabbitMQ')
    return
  }

  isConnecting = true

  try {
    // Create connection to RabbitMQ
    connection = await amqp.connect(RABBITMQ_URL)
    logInfo('Connected to RabbitMQ')

    // Create channel
    channel = await connection.createChannel()

    // Declare venues exchange
    await channel.assertExchange(VENUES_EXCHANGE, 'topic', { durable: true })

    // Declare venue-specific request queue
    const requestQueue = `requests.${venueId}`
    await channel.assertQueue(requestQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'venues.requests.dlx',
        'x-dead-letter-routing-key': `${requestQueue}.dead`
      }
    })

    // Bind to venue-specific routing pattern
    await channel.bindQueue(requestQueue, VENUES_EXCHANGE, `venue.${venueId}.#`)

    // Setup dead letter exchange and queue for requests
    await channel.assertExchange('venues.requests.dlx', 'direct', { durable: true })
    await channel.assertQueue(`${requestQueue}.dead`, { durable: true })
    await channel.bindQueue(`${requestQueue}.dead`, 'venues.requests.dlx', `${requestQueue}.dead`)

    // Declare venue-specific response queue
    const responseQueue = `responses.${venueId}`
    await channel.assertQueue(responseQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'venues.responses.dlx',
        'x-dead-letter-routing-key': `${responseQueue}.dead`
      }
    })

    // Setup dead letter exchange and queue for responses
    await channel.assertExchange('venues.responses.dlx', 'direct', { durable: true })
    await channel.assertQueue(`${responseQueue}.dead`, { durable: true })
    await channel.bindQueue(`${responseQueue}.dead`, 'venues.responses.dlx', `${responseQueue}.dead`)

    // Reset isConnecting flag
    isConnecting = false

    // Handle connection closure
    connection.on('close', handleConnectionClosed)
    connection.on('error', handleConnectionError)

    // Handle channel errors
    channel.on('error', (err) => {
      logError(`Channel error: ${err.message}`)
    })

    channel.on('close', () => {
      logInfo('Channel closed')
      channel = null
    })

    // Start consuming messages
    setupConsumers(requestQueue)

    return { connection, channel }
  } catch (error) {
    logError(`Error connecting to RabbitMQ: ${error.message}`)

    // Reset connection variables
    connection = null
    channel = null
    isConnecting = false

    // Retry connection after delay
    setTimeout(connectToRabbitMQ, 5000)

    throw error
  }
}

// Handle connection closed event
function handleConnectionClosed(error) {
  if (error) {
    logError(`RabbitMQ connection closed with error: ${error.message}`)
  } else {
    logInfo('RabbitMQ connection closed')
  }

  // Reset connection variables
  connection = null
  channel = null

  // Reset publisher state since we need to reinitialize
  resetPublisherState()

  // Try to reconnect
  setTimeout(connectToRabbitMQ, 5000)
}

// Handle connection error
function handleConnectionError(error) {
  logError(`RabbitMQ connection error: ${error.message}`)

  // Connection will close itself after an error
  if (connection) {
    try {
      connection.close()
    } catch (err) {
      // Ignore close errors
    }
  }

  // Reset publisher state
  resetPublisherState()

  // Reset connection variables
  connection = null
  channel = null
}

// Set up message consumers
function setupConsumers(requestQueue) {
  // Ensure we have a channel
  if (!channel) {
    return logError('Cannot set up consumers: No RabbitMQ channel available')
  }

  // Configure prefetch to process one message at a time
  channel.prefetch(1)

  channel.consume(requestQueue, async (msg) => {
    if (!msg) return

    try {
      // Parse the message
      const content = JSON.parse(msg.content.toString())
      const correlationId = content.correlationId

      logDebug(`Received message: ${content.operation} with correlationId: ${correlationId} for venue: ${venueId}`)

      // Process based on operation type
      switch (content.operation) {
        case 'PING':
          await handlers.ping.handlePing(content.data, correlationId)
          break
        case 'GET_SHIFTS':
          await handlers.shifts.handleGetShifts(content.data, correlationId)
          break
        case 'GET_WAITERS':
          await handlers.waiters.handleGetWaiters(content.data, correlationId)
          break
        case 'GET_PRODUCTOS_Y_CATEGORIAS':
          await handlers.products.handleGetProductosYCategorias(content.data, correlationId)
          break
        case 'PRINT_AND_PAY':
          await handlers.payments.handlePrintAndPay(content.data, correlationId)
          break
        default:
          logInfo(`Unknown operation type: ${content.operation}`)
          // Send error response with correlationId for unknown operations
          await sendResponse(
            `${content.operation}_ERROR`,
            {
              error: `Unknown operation type: ${content.operation}`
            },
            correlationId
          )
      }

      // Acknowledge the message
      channel.ack(msg)
    } catch (error) {
      logError(`Error processing message: ${error.message}`)

      // Try to extract correlationId even in case of error
      let correlationId
      try {
        const content = JSON.parse(msg.content.toString())
        correlationId = content.correlationId

        // Send error response if we have a correlationId
        if (correlationId) {
          await sendResponse(
            'PROCESSING_ERROR',
            {
              error: error.message
            },
            correlationId
          )
        }
      } catch (parseError) {
        // Can't do much if we can't parse the message
        logError(`Error parsing message content: ${parseError.message}`)
      }

      // Reject and don't requeue if it's a parsing error
      // Otherwise requeue for retry
      const requeue = error.name !== 'SyntaxError'
      channel.nack(msg, false, requeue)
    }
  })

  logInfo(`Message consumers set up successfully for venue: ${venueId}`)
}

// Send response back to cloud
export async function sendResponse(operation, data, correlationId) {
  try {
    if (!channel) {
      throw new Error('RabbitMQ channel not available')
    }

    const responseQueue = `responses.${venueId}`

    const message = {
      operation,
      data,
      correlationId,
      venueId, // Include venue ID in response
      timestamp: new Date().toISOString()
    }

    await channel.sendToQueue(responseQueue, Buffer.from(JSON.stringify(message)), {
      persistent: true
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

// Get connection for other modules to use
export function getConnection() {
  return connection
}

// Get channel for other modules to use
export function getChannel() {
  return channel
}

// Check if connected to RabbitMQ
export function isConnected() {
  return !!channel && !!connection
}

export default {
  connectToRabbitMQ,
  getConnection,
  getChannel,
  isConnected
}
