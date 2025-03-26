// src/config/rabbitmq.js
// RabbitMQ configuration
export const RABBITMQ_URL = process.env.RABBITMQ_URL
export const REQUEST_QUEUE = process.env.REQUEST_QUEUE || 'operations_queue' // Queue for receiving requests from the cloud
export const RESPONSE_QUEUE = process.env.RESPONSE_QUEUE || 'responses_queue' // Queue for sending responses back to the cloud

export default {
  RABBITMQ_URL,
  REQUEST_QUEUE,
  RESPONSE_QUEUE
}
