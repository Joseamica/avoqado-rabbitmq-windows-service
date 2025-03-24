// src/services/rabbitmq/index.js
import { connectToRabbitMQ, getChannel } from './consumer.js'
import { sendResponse } from './sender.js'

export { connectToRabbitMQ, getChannel, sendResponse }

export default {
  connectToRabbitMQ,
  getChannel,
  sendResponse
}
