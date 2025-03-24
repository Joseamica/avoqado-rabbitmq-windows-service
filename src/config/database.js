// src/config/database.js
import pkg from 'mssql'
const { ConnectionPool } = pkg

// Database configuration (extracted from socket.js)
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

// Create connection pool
export const createDbPool = async () => {
  try {
    const pool = new ConnectionPool(dbConfig)
    await pool.connect()
    console.log('Database connection established successfully')
    return pool
  } catch (error) {
    console.error('Error connecting to database:', error.message)
    throw error
  }
}

export default {
  dbConfig,
  createDbPool
}
