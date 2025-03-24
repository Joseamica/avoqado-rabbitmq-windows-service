// -----------------------
// 1) Importaciones y Configuración
// -----------------------

import io from 'socket.io-client'

export const dbConfig = {
  user: 'sa',
  password: 'National09',
  database: 'avo',
  // server: '100.95.9.40',
  // server: '100.89.250.64',
  server: '100.80.118.68',
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    instanceName: 'NATIONALSOFT',
    encrypt: false,
    trustServerCertificate: true
  }
}

const URL = 'https://ee2b-2806-2f0-9140-e9df-45a0-7fbf-a066-4e70.ngrok-free.app'
// const URL = 'https://api.avoqado.io'

// -----------------------
// 2) Crear Socket
// -----------------------
export const socket = io(URL, {
  reconnection: true,
  secure: true
})

export const rabbitConfig = {
  url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  requestQueue: 'operations_queue', // Queue for incoming messages
  responseQueue: 'responses_queue' // Queue for outgoing messages
}
