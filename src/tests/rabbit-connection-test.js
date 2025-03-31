// src/tests/rabbit-connection-test.js
import { connectToRabbitMQ, isConnected, getChannel } from '../services/rabbitmq/consumer.js'
import { logInfo, logError } from '../utils/logger.js'

const venueId = process.env.VENUE_ID || 'madre_cafecito'

async function testRabbitMQConnection() {
  logInfo('=== WINDOWS SERVICE RABBITMQ CONNECTION TEST ===')
  logInfo(`Venue ID: ${venueId}`)
  logInfo(`RabbitMQ URL: ${process.env.RABBITMQ_URL}`)

  try {
    // Step 1: Connect to RabbitMQ
    logInfo('1. Attempting to connect to RabbitMQ...')
    await connectToRabbitMQ()

    // Step 2: Verify connection status
    const connectionStatus = isConnected()
    logInfo(`2. Connection status: ${connectionStatus ? '✅ CONNECTED' : '❌ DISCONNECTED'}`)

    if (!connectionStatus) {
      throw new Error('Failed to connect to RabbitMQ')
    }

    // Step 3: Verify channel is available
    const channel = getChannel()
    logInfo(`3. Channel available: ${channel ? '✅ YES' : '❌ NO'}`)

    // Step 4: Test publishing a message
    logInfo('4. Testing message publishing to venue-specific queue...')

    const testQueue = `test.queue.${venueId}`

    // Setup test queue
    await channel.assertQueue(testQueue, { durable: false, autoDelete: true })

    // Publish test message
    const testMessage = {
      type: 'connection_test',
      timestamp: new Date().toISOString(),
      venueId: venueId,
      source: 'windows_service_test'
    }

    await channel.sendToQueue(testQueue, Buffer.from(JSON.stringify(testMessage)), { persistent: false })
    logInfo('   Message published successfully')

    // Consume test message to verify full cycle
    logInfo('5. Verifying message consumption...')

    const messagePromise = new Promise((resolve) => {
      channel.consume(testQueue, (msg) => {
        if (msg) {
          const content = JSON.parse(msg.content.toString())
          logInfo(`   Received test message: ${JSON.stringify(content)}`)
          channel.ack(msg)
          resolve(true)
        }
      })
    })

    const received = await Promise.race([messagePromise, new Promise((resolve) => setTimeout(() => resolve(false), 5000))])

    logInfo(`   Message received: ${received ? '✅ YES' : '❌ NO (TIMEOUT)'}`)

    // Clean up test resources
    await channel.deleteQueue(testQueue)

    logInfo('=== TEST COMPLETED SUCCESSFULLY ===')
    return true
  } catch (error) {
    logError(`TEST FAILED: ${error.message}`)
    logError(error.stack)
    return false
  }
}

// Run the test
testRabbitMQConnection()
  .then((success) => {
    logInfo(`Test result: ${success ? 'PASSED' : 'FAILED'}`)
    // Don't exit the process in Windows service, just report the result
  })
  .catch((error) => {
    logError(`Unhandled error in test: ${error.message}`)
  })

export default testRabbitMQConnection
