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

// NEW: Track messages sent to ensure idempotence
const recentlySentMessages = new Map()
const MAX_MESSAGE_CACHE_SIZE = 1000

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

    // Start cleanup timer for sent messages
    setInterval(cleanupSentMessages, 10 * 60 * 1000) // Clean every 10 minutes

    isInitialized = true
    logInfo('RabbitMQ publisher initialized successfully')
    return true
  } catch (error) {
    logError(`Failed to initialize RabbitMQ publisher: ${error.message}`)
    return false
  }
}

/**
 * Cleanup sent message cache to prevent memory leaks
 */
function cleanupSentMessages() {
  try {
    const now = Date.now()
    let expiredCount = 0
    
    for (const [key, data] of recentlySentMessages.entries()) {
      if (now - data.timestamp > 30 * 60 * 1000) { // 30 minutes
        recentlySentMessages.delete(key)
        expiredCount++
      }
    }
    
    // If the cache is still too large, remove oldest entries
    if (recentlySentMessages.size > MAX_MESSAGE_CACHE_SIZE) {
      const entries = [...recentlySentMessages.entries()]
      // Sort by timestamp (oldest first)
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
      
      // Remove oldest entries until we're back under the limit
      const toRemove = entries.slice(0, entries.length - MAX_MESSAGE_CACHE_SIZE)
      for (const [key] of toRemove) {
        recentlySentMessages.delete(key)
        expiredCount++
      }
    }
    
    if (expiredCount > 0) {
      logDebug(`Cleaned up ${expiredCount} expired sent message records`)
    }
  } catch (error) {
    logError(`Error cleaning up sent messages: ${error.message}`)
  }
}

/**
 * Generate a consistent deduplication key from message data
 */
function generateDeduplicationKey(eventType, data) {
  // For products, use product-specific data
  if (eventType === 'ProductEvents') {
    // Different deduplication strategies based on operation
    if (data.operation === 'DELETE') {
      return `${data.venueId}-${eventType}-${data.operation}-${data.uniqueCodeFromPos || ''}-${data.idproducto || ''}`
    } else {
      // For inserts or updates, include quantity to differentiate split bill scenarios
      return `${data.venueId}-${eventType}-${data.operation}-${data.uniqueCodeFromPos || ''}-${data.idproducto || ''}-${data.cantidad || '1'}`
    }
  }
  
  // For tickets, use ticket-specific data
  if (eventType === 'TicketEvents') {
    // Special handling for bill deletions - always generate a unique key to ensure processing
    if (data.operation === 'DELETE' || data.status === 'DELETED') {
      // Include timestamp to make every delete event unique
      return `${data.venueId}-${eventType}-${data.operation}-${data.ticket}-${data.status}-${Date.now()} `
    }
    
    // If it's a split operation, create a consistent key from related folios
    if (data.isSplit && data.splitType) {
      const bills = []
      bills.push(data.ticket || '')
      
      if (data.splitType === 'ORIGINAL' && data.relatedFolio) {
        bills.push(...(data.relatedFolio?.split(',') || []))
      } else if (data.splitType === 'NEW' && data.relatedFolio) {
        bills.push(data.relatedFolio)
      }
      
      // Sort the bills array to ensure consistent ordering
      const sortedBills = [...new Set(bills)].sort().join('-')
      return `${data.venueId}-${eventType}-split-${sortedBills}-${data.uniqueCodeFromPos || ''}`
    }
    
    // Regular ticket events - INCLUDE uniqueCodeFromPos to prevent duplicate keys for different bills with same ticket/table
    return `${data.venueId}-${eventType}-${data.operation}-${data.ticket}-${data.status}-${data.uniqueCodeFromPos || ''}`
  }
  
  // For payments
  if (eventType === 'PaymentEvents') {
    return `${data.venueId}-${eventType}-${data.folio}-${data.idFormaDePago || ''}-${data.uniqueCodeFromPos || ''}`
  }
  
  // For shifts
  if (eventType === 'TurnoEvents') {
    return `${data.venueId}-${eventType}-${data.idturno}-${data.operation}`
  }
  
  // Default fallback
  return `${data.venueId}Z-${eventType}-${JSON.stringify(data).slice(0, 100)}`
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
    
    // NEW: Generate a deduplication key
    const deduplicationKey = generateDeduplicationKey(eventType, data)
    
    // NEW: Check for duplicate messages
    if (recentlySentMessages.has(deduplicationKey)) {
      const prevSent = recentlySentMessages.get(deduplicationKey)
      logDebug(`Skipping duplicate message: ${deduplicationKey} (previously sent ${Date.now() - prevSent.timestamp}ms ago)`)
      
      // Return success since we've already sent this message
      return true
    }

    // NEW: Handle split operation metadata
    let splitOperationId = null
    if (data.isSplit && (data.splitType === 'ORIGINAL' || data.splitType === 'NEW')) {
      // Generate a consistent ID for this split operation
      const billIds = [data.ticket || data.folio]
      
      if (data.splitType === 'ORIGINAL' && data.relatedFolio) {
        // Clean up relatedFolio (sometimes it has duplicates)
        const relatedFolios = [...new Set(data.relatedFolio.split(','))]
        billIds.push(...relatedFolios)
      } else if (data.splitType === 'NEW' && data.relatedFolio) {
        billIds.push(data.relatedFolio)
      }
      
      // Sort to ensure consistency
      splitOperationId = `split-${data.venueId}-${[...new Set(billIds)].sort().join('-')}`
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
    
    // Add split operation ID if present
    if (splitOperationId) {
      enrichedData._metadata.splitOperationId = splitOperationId
    }
    
    // Preserve any existing split operation key
    if (data._splitOperationKey) {
      enrichedData._metadata.splitOperationKey = data._splitOperationKey
      delete enrichedData._splitOperationKey // Remove from main data
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
            'x-venue-id': venueId, // Add venue ID as header for filtering
            'x-deduplication-id': deduplicationKey // Add deduplication ID as header
          }
        },
        (err, ok) => {
          if (err) {
            logError(`Error in confirm callback: ${err.message}`)
            resolve(false)
          } else {
            // Only store successfully sent messages
            recentlySentMessages.set(deduplicationKey, {
              timestamp: Date.now(),
              messageId: messageId
            })
            
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