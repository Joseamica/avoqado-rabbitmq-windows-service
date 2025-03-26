// src/config/database.js
import pkg from 'mssql'
const { ConnectionPool } = pkg
import 'dotenv/config'

// Database configuration (extracted from socket.js)
export const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  // server: '100.95.9.40',
  // server: '100.89.250.64',
  server: process.env.DB_SERVER,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    instanceName: process.env.DB_INSTANCE,
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
