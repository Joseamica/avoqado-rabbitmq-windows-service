// src/services/handlers/products.js
import pkg from 'mssql'
import { createDbPool } from '../../config/database.js'
import { sendResponse } from '../rabbitmq/index.js'
import { logError } from '../../utils/logger.js'

const { Transaction } = pkg
let pool

// Initialize database pool
async function initPool() {
  if (!pool) {
    pool = await createDbPool()
  }
  return pool
}

/**
 * Handle GET_PRODUCTOS_Y_CATEGORIAS operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handleGetProductosYCategorias(data, correlationId) {
  const venueId = data.venueId || 'madre_cafecito'

  // Validate required parameters
  if (!venueId) {
    return await sendResponse(
      'GET_PRODUCTOS_Y_CATEGORIAS_ERROR',
      {
        function: 'getProductosYCategorias',
        error: 'Missing venue id'
      },
      correlationId
    )
  }

  let transaction
  try {
    pool = await initPool()
    transaction = new Transaction(pool)
    await transaction.begin()

    const request = transaction.request()

    // Step A: Validations (Mimicking SoftRestaurant's Initial Checks)
    await pool.request().batch('') // No-op query to mimic a fresh state

    const productosYCategoriasQuery = await request.query(`
    SELECT
      p.idproducto,
      p.descripcion AS nombre,
      p.idgrupo,
      g.descripcion AS categoria,
      g.clasificacion
    FROM productos p
    JOIN grupos g ON p.idgrupo = g.idgrupo;
    `)

    const productosYCategorias = productosYCategoriasQuery.recordset

    await transaction.commit()

    await sendResponse(
      'RECEIVE_PRODUCTOS_Y_CATEGORIAS',
      {
        venueId,
        data: productosYCategorias
      },
      correlationId
    )

    console.log('Procesado getProductosYCategorias con correlationId:', correlationId)
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr)
      }
    }

    logError(`Error in getProductosYCategorias: ${error.message}`)
    console.error('Error en getProductosYCategorias:', error)

    await sendResponse(
      'GET_PRODUCTOS_Y_CATEGORIAS_ERROR',
      {
        venueId,
        error: error.message
      },
      correlationId
    )
  }
}

export default {
  handleGetProductosYCategorias
}
