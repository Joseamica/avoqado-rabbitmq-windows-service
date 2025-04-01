// src/services/handlers/shifts.js
import pkg from 'mssql'
import { createDbPool } from '../../config/database.js'
import { sendResponse } from '../rabbitmq/index.js'

import { logError } from '../../utils/logger.js'
import { getHostname } from '../../utils/helper.js'

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
 * Handle GET_SHIFTS operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handleGetShifts(data, correlationId) {
  const hostname = getHostname()
  const venueId = data.venueId || 'madre_cafecito'
  let transaction

  try {
    pool = await initPool()
    transaction = new Transaction(pool)
    await transaction.begin()

    let request = transaction.request()

    // Get station data
    const estacionQuery = await request.input('hostname', hostname).query(`
      SELECT idestacion, seriefolio FROM estaciones WHERE idestacion = @hostname
    `)

    if (!estacionQuery.recordset.length) {
      await transaction.commit()
      await sendResponse(
        'GET_SHIFTS_ERROR',
        {
          message: 'Estación no encontrada.'
        },
        correlationId,
        venueId
      )
      return
    }

    const { idestacion, seriefolio: serie } = estacionQuery.recordset[0]

    request = transaction.request() // New request to avoid conflicts

    // Get active shift
    const turnoQuery = await request.input('idestacion', idestacion).query(`
      SELECT TOP 1 idturno, cajero FROM turnos 
      WHERE cierre IS NULL AND apertura IS NOT NULL 
      AND idestacion = @idestacion
    `)

    await transaction.commit()

    if (!turnoQuery.recordset.length) {
      console.log(`⚠️ No hay turnos abiertos para la estación: ${idestacion}`)
      await sendResponse(
        'GET_SHIFTS_SUCCESS',
        {
          message: 'No hay turnos abiertos para esta estación.',
          turno: null
        },
        correlationId
      )
      return
    }

    console.log(`✅ Turno obtenido correctamente para la estación: ${idestacion}`)
    await sendResponse(
      'GET_SHIFTS_SUCCESS',
      {
        message: 'Se ha obtenido el turno correctamente.',
        turno: turnoQuery.recordset[0]
      },
      correlationId,
      venueId
    )
  } catch (error) {
    console.error('❌ Error al obtener turno:', error.message || error)
    logError(`Error getting shift: ${error.message}`)

    // If there's an error, rollback the transaction if it was open
    if (transaction) {
      try {
        await transaction.rollback()
        console.log('🔄 Transacción revertida.')
      } catch (rollbackError) {
        console.error('⚠️ Error al revertir la transacción:', rollbackError)
      }
    }

    await sendResponse(
      'GET_SHIFTS_ERROR',
      {
        message: 'Error interno al obtener el turno. Intente de nuevo.'
      },
      correlationId,
      venueId
    )
  }
}

export default {
  handleGetShifts
}
