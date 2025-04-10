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

/**
 * Handle OPEN_SHIFT operation
 * @param {Object} data - Request data including userId (cashier/waiter)
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handleOpenShift(data, correlationId) {
  const hostname = getHostname()
  const venueId = data.venueId || 'madre_cafecito'
  const userId = data.userId || ''
  const initialFund = data.initialFund || 0
  const initialFundDollars = data.initialFundDollars || 0
  let transaction

  try {
    pool = await initPool()
    transaction = new Transaction(pool)
    await transaction.begin()

    // 1. Get station data
    let request = transaction.request()
    const stationQuery = await request.input('hostname', hostname).query(`
      SELECT idestacion, seriefolio FROM estaciones WHERE idestacion = @hostname
    `)

    if (!stationQuery.recordset.length) {
      await transaction.rollback()
      await sendResponse(
        'OPEN_SHIFT_ERROR',
        {
          message: 'Estación no encontrada.'
        },
        correlationId,
        venueId
      )
      return
    }

    const { idestacion } = stationQuery.recordset[0]

    // 2. Check if there's already an open shift
    request = transaction.request()
    const openShiftQuery = await request.input('idestacion', idestacion).query(`
      SELECT * FROM turnos 
      WHERE cierre IS NULL AND apertura IS NOT NULL 
      AND idestacion = @idestacion AND idempresa = '0000000001'
    `)

    if (openShiftQuery.recordset.length > 0) {
      await transaction.rollback()
      await sendResponse(
        'OPEN_SHIFT_ERROR',
        {
          message: 'Ya existe un turno abierto para esta estación.'
        },
        correlationId,
        venueId
      )
      return
    }

    // 3. Get the next shift ID from parametros
    request = transaction.request()
    const nextShiftQuery = await request.query(`
      SELECT ultimoturno FROM parametros
    `)
    
    const ultimoTurno = nextShiftQuery.recordset[0]?.ultimoturno || 0
    const newShiftId = ultimoTurno + 1

    // 4. Get the current date/time
    const now = new Date()
    const formattedDateTime = now.toISOString().replace('T', ' ').substr(0, 19)
    const sqlFormattedDate = now.toLocaleDateString('en-US', {
      month: '2-digit', 
      day: '2-digit',
      year: 'numeric'
    }) + ' ' + now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })

    // 5. Insert the new shift
    request = transaction.request()
    await request
      .input('idturno', newShiftId)
      .input('fondo', initialFund)
      .input('apertura', sqlFormattedDate)
      .input('idestacion', idestacion)
      .input('cajero', userId)
      .input('idempresa', '0000000001')
      .input('idmesero', '')
      .input('fondodolares', initialFundDollars)
      .query(`
        INSERT INTO turnos (idturno, fondo, apertura, idestacion, cajero, idempresa, idmesero, fondodolares) 
        VALUES (@idturno, @fondo, @apertura, @idestacion, @cajero, @idempresa, @idmesero, @fondodolares)
      `)

    // 6. Insert into bitacoraenvioventas
    request = transaction.request()
    await request
      .input('fechaapertura', now.toISOString())
      .query(`
        INSERT INTO bitacoraenvioventas (fechaapertura) VALUES (@fechaapertura)
      `)

    // 7. Update parametros with the new ultimoturno
    request = transaction.request()
    await request
      .input('newShiftId', newShiftId)
      .query(`
        UPDATE parametros SET ultimoturno = @newShiftId
      `)

    // 8. Commit the transaction
    await transaction.commit()

    console.log(`✅ Turno abierto correctamente para la estación: ${idestacion}, ID: ${newShiftId}`)
    await sendResponse(
      'OPEN_SHIFT_SUCCESS',
      {
        message: 'Turno abierto correctamente.',
        turno: {
          idturno: newShiftId,
          cajero: userId,
          idestacion
        }
      },
      correlationId
    )
  } catch (error) {
    console.error('❌ Error al abrir turno:', error.message || error)
    logError(`Error opening shift: ${error.message}`)

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
      'OPEN_SHIFT_ERROR',
      {
        message: 'Error interno al abrir el turno. Intente de nuevo.'
      },
      correlationId
    )
  }
}

export default {
  handleGetShifts,
  handleOpenShift
}
