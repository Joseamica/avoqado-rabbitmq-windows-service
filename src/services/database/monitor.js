// src/services/database/monitor.js
import { logInfo, logError, logDebug } from '../../utils/logger.js'
import { dbConfig } from '../../config/database.js'
import sql from 'mssql'
import { publishEvent } from '../rabbitmq/publisher.js'

// Polling intervals
const MIN_POLLING_INTERVAL_MS = 5000
const MAX_POLLING_INTERVAL_MS = 60000
const BACKOFF_INTERVAL_MS = 5000

// Track if events were found in last polling cycle
let lastPollFoundEvents = false
let currentPollingInterval = MIN_POLLING_INTERVAL_MS

// SQL Queries with NOLOCK hints to reduce blocking
const TICKET_EVENTS_QUERY = `
  SELECT TOP 20 * 
  FROM TicketEvents WITH (NOLOCK) 
  WHERE IsProcessed = 0 
  ORDER BY CreateDate`

const PRODUCT_EVENTS_QUERY = `
  SELECT TOP 20 * 
  FROM ProductEvents WITH (NOLOCK) 
  WHERE UpdateDate IS NULL`

const PAYMENT_EVENTS_QUERY = `
  SELECT TOP 20 * 
  FROM PaymentEvents WITH (NOLOCK) 
  WHERE UpdateDate IS NULL`

const TURNO_EVENTS_QUERY = `
  SELECT TOP 20 * 
  FROM TurnoEvents WITH (NOLOCK) 
  WHERE UpdateDate IS NULL`

// Update queries
const MARK_TICKET_PROCESSED = `
  UPDATE TicketEvents 
  SET IsProcessed = 1, 
      ProcessedDate = @processedDate, 
      Response = @response, 
      UpdateDate = @updateDate 
  WHERE ID = @id`

const MARK_OTHER_PROCESSED = `
  UPDATE ${0} 
  SET IsSuccess = 1, 
      IsFailed = 0, 
      Response = @response, 
      UpdateDate = @updateDate 
  WHERE ID = @id`

const MARK_OTHER_FAILED = `
  UPDATE ${0} 
  SET IsSuccess = 0, 
      IsFailed = 1, 
      Response = @response, 
      UpdateDate = @updateDate 
  WHERE ID = @id`

// Pool for database connections
let pool = null
let isRunning = false
let shouldStop = false

// Initialize database connection pool
export async function initDatabaseMonitor() {
  try {
    pool = await new sql.ConnectionPool(dbConfig).connect()
    logInfo('Database monitor initialized')
    return true
  } catch (error) {
    logError(`Failed to initialize database monitor: ${error.message}`)
    throw error
  }
}

// Start monitoring the database for changes
export async function startMonitoring(venueId) {
  if (isRunning) {
    logInfo('Database monitor is already running')
    return
  }

  if (!pool) {
    await initDatabaseMonitor()
  }

  isRunning = true
  shouldStop = false

  logInfo('Database monitoring started')

  // Main monitoring loop
  while (isRunning && !shouldStop) {
    try {
      const startTime = Date.now()

      // Check each table for changes and process them
      const [ticketChangesFound, productChangesFound, paymentChangesFound, turnoChangesFound] = await Promise.all([
        processTicketEvents(venueId),
        processProductEvents(venueId),
        processPaymentEvents(venueId),
        processTurnoEvents(venueId)
      ])

      // Adjust polling interval based on whether we found changes
      const foundChanges = ticketChangesFound || productChangesFound || paymentChangesFound || turnoChangesFound

      adjustPollingInterval(foundChanges)

      const processingTime = Date.now() - startTime
      logDebug(`Processing cycle completed in ${processingTime}ms, next poll in ${currentPollingInterval}ms`)

      // Wait for the next polling interval
      await new Promise((resolve) => setTimeout(resolve, currentPollingInterval))
    } catch (error) {
      logError(`Error in monitoring cycle: ${error.message}`)

      // Use max polling interval when errors occur
      currentPollingInterval = MAX_POLLING_INTERVAL_MS
      await new Promise((resolve) => setTimeout(resolve, currentPollingInterval))
    }
  }

  logInfo('Database monitoring stopped')
  isRunning = false
}

// Stop the monitoring process
export function stopMonitoring() {
  logInfo('Stopping database monitor...')
  shouldStop = true
}

// Process ticket events
async function processTicketEvents(venueId) {
  try {
    const result = await pool.request().query(TICKET_EVENTS_QUERY)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} ticket events to process`)

    for (const row of result.recordset) {
      try {
        // Build message object
        const message = {
          venueId,
          ticket: row.Folio,
          table: row.TableNumber,
          order: row.OrderNumber,
          status: row.EventType,
          idWaiter: row.WaiterId,
          waiterName: row.WaiterName,
          operation: row.OperationType,
          uniqueCodeFromPos: row.UniqueCode
        }

        // Add financial data if available
        if (row.Descuento !== null) message.descuento = row.Descuento
        if (row.Total !== null) message.total = row.Total

        // Add split operation details if applicable
        if (row.IsSplitOperation) {
          message.isSplit = true

          if (row.SplitRole === 'PARENT') {
            message.splitType = 'ORIGINAL'
            message.relatedFolio = row.SplitFolios
            message.splitTables = row.SplitTables
          } else if (row.SplitRole === 'CHILD') {
            message.splitType = 'NEW'
            message.relatedFolio = row.ParentFolio
            message.originalTable = row.OriginalTable
          }
        }

        // RENAMED special handling
        if (row.EventType === 'RENAMED') {
          message.status = 'OPEN' // Use OPEN status for compatibility
          message.isRenamed = true
          message.originalTable = row.OriginalTable
        }

        // PRINTED special handling
        if (row.EventType === 'PRINTED') {
          message.status = 'OPEN'
          message.isPrinted = true
        }

        // Publish to RabbitMQ
        const success = await publishEvent('TicketEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = success ? 'Successfully published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool
          .request()
          .input('processedDate', sql.DateTimeOffset, now)
          .input('response', sql.NVarChar, response)
          .input('updateDate', sql.DateTimeOffset, now)
          .input('id', sql.Int, row.ID)
          .query(MARK_TICKET_PROCESSED)

        logDebug(`Processed ticket event ${row.ID}, status: ${success ? 'success' : 'failed'}`)
      } catch (error) {
        logError(`Error processing ticket event ${row.ID}: ${error.message}`)

        // Mark as failed but processed
        const now = new Date().toISOString()
        await pool
          .request()
          .input('processedDate', sql.DateTimeOffset, now)
          .input('response', sql.NVarChar, `Error: ${error.message}`)
          .input('updateDate', sql.DateTimeOffset, now)
          .input('id', sql.Int, row.ID)
          .query(MARK_TICKET_PROCESSED)
      }
    }

    return true
  } catch (error) {
    logError(`Error querying ticket events: ${error.message}`)
    return false
  }
}

// Process product events
async function processProductEvents(venueId) {
  try {
    const result = await pool.request().query(PRODUCT_EVENTS_QUERY)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} product events to process`)

    for (const row of result.recordset) {
      try {
        // Build message object
        const message = {
          venueId,
          ticket: row.Folio,
          table: row.TableNumber,
          order: row.OrderNumber,
          status: row.Status,
          idproducto: row.IdProducto,
          nombre: row.NombreProducto,
          movimiento: row.Movimiento,
          cantidad: row.Cantidad,
          precio: row.Precio,
          idWaiter: row.WaiterId,
          waiterName: row.WaiterName,
          operation: row.OperationType,
          uniqueCodeFromPos: row.UniqueCode,
          uniqueBillCodeFromPos: row.uniqueBillCodeFromPos
        }

        // Add optional fields if present
        if (row.Descuento !== null) message.descuento = row.Descuento
        if (row.Hora !== null) message.hora = row.Hora
        if (row.Modificador !== null) message.modificador = row.Modificador
        if (row.Clasificacion !== null) message.clasificacion = row.Clasificacion
        if (row.IsSplitTable !== null) message.isSplitTable = row.IsSplitTable
        if (row.MainTable !== null) message.mainTable = row.MainTable
        if (row.SplitSuffix !== null) message.splitSuffix = row.SplitSuffix

        // Publish to RabbitMQ
        const success = await publishEvent('ProductEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = success ? 'Successfully published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_PROCESSED.replace('${0}', 'ProductEvents'))

        logDebug(`Processed product event ${row.ID}, status: ${success ? 'success' : 'failed'}`)
      } catch (error) {
        logError(`Error processing product event ${row.ID}: ${error.message}`)

        // Mark as failed
        const now = new Date().toISOString()
        await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_FAILED.replace('${0}', 'ProductEvents'))
      }
    }

    return true
  } catch (error) {
    logError(`Error querying product events: ${error.message}`)
    return false
  }
}

// Process payment events
async function processPaymentEvents(venueId) {
  try {
    const result = await pool.request().query(PAYMENT_EVENTS_QUERY)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} payment events to process`)

    for (const row of result.recordset) {
      try {
        // Build message object
        const message = {
          venueId,
          folio: row.Folio,
          idFormaDePago: row.IdFormaDePago,
          table: row.TableNumber,
          operation: row.OperationType,
          status: row.Status
        }

        // Add optional fields if present
        if (row.Importe !== null) message.importe = row.Importe
        if (row.Propina !== null) message.propina = row.Propina
        if (row.Referencia !== null) message.referencia = row.Referencia
        if (row.WorkspaceId !== null) message.uniqueCodeFromPos = row.WorkspaceId
        if (row.UniqueBillCodePos !== null) message.uniqueBillCodePos = row.UniqueBillCodePos
        if (row.Method !== null) message.method = row.Method
        if (row.OrderNumber !== null) message.order = row.OrderNumber
        if (row.IsSplitTable !== null) message.is_split_table = row.IsSplitTable
        if (row.MainTable !== null) message.main_table = row.MainTable
        if (row.SplitSuffix !== null) message.split_suffix = row.SplitSuffix

        // Publish to RabbitMQ
        const success = await publishEvent('PaymentEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = success ? 'Successfully published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_PROCESSED.replace('${0}', 'PaymentEvents'))

        logDebug(`Processed payment event ${row.ID}, status: ${success ? 'success' : 'failed'}`)
      } catch (error) {
        logError(`Error processing payment event ${row.ID}: ${error.message}`)

        // Mark as failed
        const now = new Date().toISOString()
        await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_FAILED.replace('${0}', 'PaymentEvents'))
      }
    }

    return true
  } catch (error) {
    logError(`Error querying payment events: ${error.message}`)
    return false
  }
}

// Process turno events
async function processTurnoEvents(venueId) {
  try {
    const result = await pool.request().query(TURNO_EVENTS_QUERY)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} turno events to process`)

    for (const row of result.recordset) {
      try {
        // Build message object
        const message = {
          venueId,
          idturnointerno: row.IdTurnoInterno,
          idturno: row.IdTurno,
          fondo: row.Fondo,
          operation: row.OperationType
        }

        // Handle dates properly
        if (row.Apertura) {
          message.apertura = new Date(row.Apertura).toISOString()
        }

        if (row.Cierre) {
          message.cierre = new Date(row.Cierre).toISOString()
        } else {
          message.cierre = null
        }

        // Add optional fields if present
        if (row.Cajero !== null) message.cajero = row.Cajero
        if (row.Efectivo !== null) message.efectivo = row.Efectivo
        if (row.Tarjeta !== null) message.tarjeta = row.Tarjeta
        if (row.Vales !== null) message.vales = row.Vales
        if (row.Credito !== null) message.credito = row.Credito
        if (row.CorteEnviado !== null) message.corte_enviado = row.CorteEnviado

        // Publish to RabbitMQ
        const success = await publishEvent('TurnoEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = success ? 'Successfully published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_PROCESSED.replace('${0}', 'TurnoEvents'))

        logDebug(`Processed turno event ${row.ID}, status: ${success ? 'success' : 'failed'}`)
      } catch (error) {
        logError(`Error processing turno event ${row.ID}: ${error.message}`)

        // Mark as failed
        const now = new Date().toISOString()
        await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(MARK_OTHER_FAILED.replace('${0}', 'TurnoEvents'))
      }
    }

    return true
  } catch (error) {
    logError(`Error querying turno events: ${error.message}`)
    return false
  }
}

// Adjust polling interval based on activity
function adjustPollingInterval(foundEvents) {
  if (foundEvents) {
    // If we found events, poll more frequently
    currentPollingInterval = MIN_POLLING_INTERVAL_MS
    lastPollFoundEvents = true
  } else {
    // If we didn't find events this time or last time, back off
    if (!lastPollFoundEvents) {
      currentPollingInterval = Math.min(currentPollingInterval + BACKOFF_INTERVAL_MS, MAX_POLLING_INTERVAL_MS)
    }
    lastPollFoundEvents = false
  }
}

export default {
  initDatabaseMonitor,
  startMonitoring,
  stopMonitoring
}
