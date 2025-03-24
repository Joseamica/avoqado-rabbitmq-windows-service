// src/services/rabbitmq/consumer.js
import amqp from 'amqplib'
import { RABBITMQ_URL, REQUEST_QUEUE, RESPONSE_QUEUE } from '../../config/rabbitmq.js'
import { logError } from '../../utils/logger.js'
import * as handlers from '../handlers/index.js'
import { sendResponse } from './sender.js'

// Variables for RabbitMQ connection
let connection, channel

// Connect to RabbitMQ
export async function connectToRabbitMQ() {
  try {
    // Create connection to RabbitMQ
    connection = await amqp.connect(RABBITMQ_URL)
    channel = await connection.createChannel()

    // Ensure queues exist
    await channel.assertQueue(REQUEST_QUEUE, { durable: true })
    await channel.assertQueue(RESPONSE_QUEUE, { durable: true })

    console.log('Connected to RabbitMQ')

    // Handle connection closure
    connection.on('close', () => {
      console.log('🔄 RabbitMQ connection closed, attempting to reconnect...')
      setTimeout(connectToRabbitMQ, 5000)
    })

    // Start consuming messages
    setupConsumers()

    return { connection, channel }
  } catch (error) {
    logError(`❌ Error connecting to RabbitMQ: ${error.message}`)
    console.error('Failed to connect to RabbitMQ:', error)
    setTimeout(connectToRabbitMQ, 5000)
  }
}

// Set up message consumers
function setupConsumers() {
  // Ensure we have a channel
  if (!channel) {
    return logError('Cannot set up consumers: No RabbitMQ channel available')
  }

  // Configure prefetch to process one message at a time
  channel.prefetch(1)

  channel.consume(REQUEST_QUEUE, async (msg) => {
    if (!msg) return

    try {
      // Parse the message
      const content = JSON.parse(msg.content.toString())
      const correlationId = content.correlationId
      console.log('Received message:', content.operation, 'with correlationId:', correlationId)

      // Process based on operation type
      switch (content.operation) {
        case 'GET_SHIFTS':
          await handlers.shifts.handleGetShifts(content.data, correlationId)
          break
        case 'REQUEST_WAITERS':
          await handlers.waiters.handleRequestWaiters(content.data, correlationId)
          break
        case 'GET_PRODUCTOS_Y_CATEGORIAS':
          await handlers.products.handleGetProductosYCategorias(content.data, correlationId)
          break
        case 'PRINT_AND_PAY':
          await handlers.payments.handlePrintAndPay(content.data, correlationId)
          break
        default:
          console.warn(`Unknown operation type: ${content.operation}`)
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
        console.error('Error parsing message content:', parseError)
      }

      // Reject and don't requeue if it's a parsing error
      // Otherwise requeue for retry
      const requeue = error.name !== 'SyntaxError'
      channel.nack(msg, false, requeue)
    }
  })

  console.log('Message consumers set up successfully')
}

// Get channel for other modules to use
export function getChannel() {
  return channel
}

export default {
  connectToRabbitMQ,
  getChannel
}
