// src/services/poller/databasePoller.js
import { logInfo, logError, logDebug } from '../../utils/logger.js'
import { publishEvent } from '../rabbitmq/publisher.js'
import { getConfig } from '../../config/index.js'

// Track active shift closures
const activeShiftClosures = new Map()
const SHIFT_CLOSURE_TIMEOUT_MINUTES = 10

// Store performance stats
const performanceStats = {
  DB_Query: [],
  RabbitMQ_Publish: [],
  Processing: [],
  Polling_Cycle: []
}

// Track last performance report time
let lastPerformanceReport = new Date()
const PERFORMANCE_REPORT_INTERVAL_MINUTES = 15

// Configure adaptive polling
let currentPollingInterval = 5000 // Start with 5 seconds
let lastPollFoundEvents = false
let cleanupCounter = 0
const CLEANUP_INTERVAL = 20 // Run cleanup every 20 polling cycles

/**
 * Initialize the database poller
 * @param {Object} pool - The database connection pool
 * @param {Object} config - The application config
 */
export async function initDatabasePoller(pool, config) {
  const pollerConfig = config.poller || {}

  // Set initial polling intervals from config
  currentPollingInterval = pollerConfig.minPollingIntervalMs || 5000
  const maxPollingIntervalMs = pollerConfig.maxPollingIntervalMs || 60000
  const pollingBackoffMs = pollerConfig.pollingBackoffMs || 5000

  logInfo('Database poller initialized with polling interval: ' + currentPollingInterval + 'ms')

  // Start the polling loop
  await startPolling(pool, {
    currentPollingInterval,
    maxPollingIntervalMs,
    pollingBackoffMs
  })
}

/**
 * Start the polling loop
 */
async function startPolling(pool, pollingConfig) {
  let running = true

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    running = false
    logInfo('Stopping database poller...')
  })

  while (running) {
    const cycleStartTime = new Date()
    let foundEventsThisCycle = false

    try {
      // Process events for each table
      const ticketsFound = await processTicketEvents(pool)
      const productsFound = await processProductEvents(pool)
      const turnosFound = await processTurnoEvents(pool)
      const paymentsFound = await processPaymentEvents(pool)

      // If any task found events, we consider that we found events in this cycle
      foundEventsThisCycle = ticketsFound || productsFound || turnosFound || paymentsFound

      // Adjust polling interval based on whether we found events
      adjustPollingInterval(foundEventsThisCycle, pollingConfig)

      // Calculate cycle time and track it
      const cycleDuration = new Date() - cycleStartTime
      trackPerformanceStat('Polling_Cycle', cycleDuration)

      // Log the waiting time and cycle duration
      logInfo(`Cycle completed in ${cycleDuration}ms. Waiting ${currentPollingInterval / 1000} seconds until next poll`)

      // Check if we need to output performance report
      if ((new Date() - lastPerformanceReport) / (1000 * 60) >= PERFORMANCE_REPORT_INTERVAL_MINUTES) {
        outputPerformanceReport()
        lastPerformanceReport = new Date()
      }

      // Increment cleanup counter and run cleanup if needed
      cleanupCounter++
      if (cleanupCounter >= CLEANUP_INTERVAL) {
        cleanupShiftClosureCache()
        cleanupCounter = 0
      }

      // Wait according to current polling interval
      await new Promise((resolve) => setTimeout(resolve, currentPollingInterval))
    } catch (error) {
      logError(`Error in main polling loop: ${error.message}`)

      // Use max polling interval when errors occur
      currentPollingInterval = pollingConfig.maxPollingIntervalMs
      await new Promise((resolve) => setTimeout(resolve, currentPollingInterval))
    }
  }

  logInfo('Database polling stopped')
}

/**
 * Process pending ticket events
 */
async function processTicketEvents(pool) {
  const startTime = new Date()
  let foundEvents = false

  try {
    // SQL query to get pending ticket events
    const sql = `
      SELECT TOP 20 * FROM TicketEvents WITH (NOLOCK) 
      WHERE IsProcessed = 0 
      ORDER BY CreateDate
    `

    // Execute query
    const result = await pool.request().query(sql)
    const queryTime = new Date() - startTime
    trackPerformanceStat('DB_Query', queryTime)

    if (result.recordset && result.recordset.length > 0) {
      const rowCount = result.recordset.length
      logInfo(`Processing ${rowCount} TicketEvents (query took ${queryTime}ms)`)
      foundEvents = true

      const processingStartTime = new Date()
      let processedCount = 0

      // Process each row
      for (const row of result.recordset) {
        const rowStartTime = new Date()

        await processTicketEvent(pool, row)
        processedCount++

        const rowProcessTime = new Date() - rowStartTime
        trackPerformanceStat('Processing', rowProcessTime)

        // Log every 5th row to avoid excessive logging
        if (processedCount % 5 === 0 || processedCount === rowCount) {
          logInfo(`Processed ${processedCount}/${rowCount} TicketEvents rows. Last row took ${rowProcessTime}ms`)
        }
      }

      const totalProcessingTime = new Date() - processingStartTime
      logInfo(`Completed processing ${rowCount} TicketEvents in ${totalProcessingTime}ms`)
    }

    const totalOperationTime = new Date() - startTime
    if (foundEvents) {
      logInfo(`Total TicketEvents processing operation took ${totalOperationTime}ms`)
    } else {
      logDebug(`No TicketEvents found. Query took ${queryTime}ms`)
    }
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing TicketEvents: ${error.message}. Operation took ${errorTime}ms`)
  }

  return foundEvents
}

/**
 * Process a single ticket event
 */
async function processTicketEvent(pool, row) {
  const startTime = new Date()
  const id = row.ID
  logDebug(`Processing ticket event ID ${id}`)

  try {
    // Get basic properties
    const eventType = row.EventType
    const operationType = row.OperationType
    const folio = row.Folio
    const tableNumber = row.TableNumber
    let isSplitOperation = false

    // Check if this is a split operation
    if (row.IsSplitOperation) {
      isSplitOperation = true
      logInfo(`Processing split operation: Folio ${folio}, TableNumber ${tableNumber}, SplitRole ${row.SplitRole}`)
    }

    // Filter DELETE operations during shift closure
    if (eventType === 'DELETED' && operationType === 'DELETE') {
      // Check if this is from a known active shift closure
      if (row.ShiftId) {
        const shiftId = row.ShiftId
        if (activeShiftClosures.has(shiftId)) {
          const shiftClosureTime = activeShiftClosures.get(shiftId)
          if ((new Date() - shiftClosureTime) / (1000 * 60) < SHIFT_CLOSURE_TIMEOUT_MINUTES) {
            // This is definitely part of a shift closure
            await markEventAsSuccess(pool, 'TicketEvents', id, 'Filtered: Ticket deletion during shift closure')

            const closureFilterTime = new Date() - startTime
            logInfo(`Filtered ticket deletion event ID ${id}: shift closure detected. Operation took ${closureFilterTime}ms`)
            return
          }
        }
      }

      // If we don't have the ShiftId or it's not in activeShiftClosures, check other indicators
      const isBulkDeletion = await isBulkTicketDeletionInProgress(pool)
      if (isBulkDeletion) {
        await markEventAsSuccess(pool, 'TicketEvents', id, 'Filtered: Ticket deletion during bulk operation (likely shift closure)')

        const closureFilterTime = new Date() - startTime
        logInfo(`Filtered ticket deletion event ID ${id}: bulk deletion pattern detected. Operation took ${closureFilterTime}ms`)
        return
      }
    }

    // Skip further processing for SHIFT_CLOSURE records
    if (eventType === 'SHIFT_CLOSURE' && operationType === 'SHIFT_CLOSURE') {
      await markEventAsSuccess(pool, 'TicketEvents', id, 'Shift closure notification processed')
      logInfo(`Processed shift closure notification event ID ${id}`)
      return
    }

    // Build message object for tickets
    const messageObject = {
      venueId: getConfig().VenueId
    }

    // Basic properties
    if (folio) messageObject.ticket = folio
    if (tableNumber) messageObject.table = tableNumber
    if (row.OrderNumber) messageObject.order = parseInt(row.OrderNumber, 10)

    // For renamed tables, map to a status the API can handle
    if (eventType === 'RENAMED') {
      messageObject.status = 'OPEN'
      messageObject.isRenamed = true
      if (row.OriginalTable) messageObject.originalTable = row.OriginalTable
    } else if (eventType === 'PRINTED') {
      messageObject.status = 'OPEN'
      messageObject.isPrinted = true
    } else {
      messageObject.status = eventType
    }

    // Common properties
    if (row.WaiterId) messageObject.idWaiter = row.WaiterId
    if (row.WaiterName) messageObject.waiterName = row.WaiterName
    if (operationType) messageObject.operation = operationType
    if (row.UniqueCode) messageObject.uniqueCodeFromPos = row.UniqueCode

    // Financial data
    if (row.Descuento) messageObject.descuento = parseFloat(row.Descuento)
    if (row.Total) messageObject.total = parseFloat(row.Total)

    // Add split operation details
    if (isSplitOperation) {
      messageObject.isSplit = true

      const splitRole = row.SplitRole
      if (splitRole === 'PARENT') {
        // This is the original bill that was split
        messageObject.splitType = 'ORIGINAL'
        if (row.SplitFolios) messageObject.relatedFolio = row.SplitFolios
        if (row.SplitTables) messageObject.splitTables = row.SplitTables

        logInfo(`Processing PARENT bill: ${folio} with split bills: ${row.SplitFolios}`)
      } else if (splitRole === 'CHILD') {
        // This is a split bill
        messageObject.splitType = 'NEW'
        if (row.ParentFolio) messageObject.relatedFolio = row.ParentFolio
        if (row.OriginalTable) messageObject.originalTable = row.OriginalTable

        logInfo(`Processing CHILD bill: ${folio} from original bill: ${row.ParentFolio}`)
      }
    }

    // Preparation time before publishing
    const preparationTime = new Date() - startTime

    // Log special events
    if (eventType === 'PAID') {
      logInfo(`Processing PAID bill: ${folio}, table: ${tableNumber}`)
    }

    // Publish to RabbitMQ
    const publishStartTime = new Date()
    const publishResult = await publishEvent('TicketEvents', messageObject)
    const publishTime = new Date() - publishStartTime
    trackPerformanceStat('RabbitMQ_Publish', publishTime)

    if (publishResult.success) {
      await markEventAsSuccess(pool, 'TicketEvents', id, publishResult.message)
    } else {
      await markEventAsFailed(pool, 'TicketEvents', id, publishResult.message)
    }

    const totalTime = new Date() - startTime
    logInfo(`Ticket event ID ${id} processed: ${preparationTime}ms prep, ${publishTime}ms RabbitMQ, ${totalTime}ms total`)
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing ticket event ID ${id}: ${error.message}. Operation took ${errorTime}ms`)
    await markEventAsFailed(pool, 'TicketEvents', id, error.message)
  }
}

/**
 * Process product events
 */
async function processProductEvents(pool) {
  const startTime = new Date()
  let foundEvents = false

  try {
    // SQL query to get pending product events
    const sql = `
      SELECT TOP 20 * FROM ProductEvents WITH (NOLOCK) 
      WHERE UpdateDate IS NULL
    `

    // Execute query
    const result = await pool.request().query(sql)
    const queryTime = new Date() - startTime
    trackPerformanceStat('DB_Query', queryTime)

    if (result.recordset && result.recordset.length > 0) {
      const rowCount = result.recordset.length
      logInfo(`Processing ${rowCount} ProductEvents (query took ${queryTime}ms)`)
      foundEvents = true

      const processingStartTime = new Date()
      let processedCount = 0

      // Process each row
      for (const row of result.recordset) {
        const rowStartTime = new Date()

        await processProductEvent(pool, row)
        processedCount++

        const rowProcessTime = new Date() - rowStartTime
        trackPerformanceStat('Processing', rowProcessTime)

        // Log every 5th row to avoid excessive logging
        if (processedCount % 5 === 0 || processedCount === rowCount) {
          logInfo(`Processed ${processedCount}/${rowCount} ProductEvents rows. Last row took ${rowProcessTime}ms`)
        }
      }

      const totalProcessingTime = new Date() - processingStartTime
      logInfo(`Completed processing ${rowCount} ProductEvents in ${totalProcessingTime}ms`)
    }

    const totalOperationTime = new Date() - startTime
    if (foundEvents) {
      logInfo(`Total ProductEvents processing operation took ${totalOperationTime}ms`)
    } else {
      logDebug(`No ProductEvents found. Query took ${queryTime}ms`)
    }
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing ProductEvents: ${error.message}. Operation took ${errorTime}ms`)
  }

  return foundEvents
}

/**
 * Process a single product event
 */
async function processProductEvent(pool, row) {
  const startTime = new Date()
  const id = row.ID
  logDebug(`Processing product event ID ${id}`)

  try {
    // Check if this is a removal operation
    const status = row.Status
    const operationType = row.OperationType
    const folio = row.Folio

    // Only apply shift closure detection to DELETE operations
    if (status === 'PRODUCT_REMOVED' && operationType === 'DELETE') {
      // Log information about the product being removed
      const productId = row.IdProducto || 'unknown'
      const productName = row.NombreProducto || 'unknown'

      logInfo(`Processing deletion of product ${productId} (${productName}) from folio ${folio}`)

      // Track single-product deletion stats
      let isSingleProductDeletion = true
      let isShiftClosure = false

      // 1. First check if there's an active shift closure in our cache
      let shiftId = 0
      if (row.ShiftId) {
        shiftId = row.ShiftId

        if (activeShiftClosures.has(shiftId)) {
          const shiftClosureTime = activeShiftClosures.get(shiftId)
          if ((new Date() - shiftClosureTime) / (1000 * 60) < SHIFT_CLOSURE_TIMEOUT_MINUTES) {
            // This is definitely part of a shift closure
            isShiftClosure = true
            logInfo(`Deletion is part of known active shift closure for shift ${shiftId}`)
          }
        }
      } else {
        // Only look up the shift ID if we don't already have it
        shiftId = await getShiftIdForFolio(pool, folio)
        if (shiftId > 0 && activeShiftClosures.has(shiftId)) {
          const shiftClosureTime = activeShiftClosures.get(shiftId)
          if ((new Date() - shiftClosureTime) / (1000 * 60) < SHIFT_CLOSURE_TIMEOUT_MINUTES) {
            // This is definitely part of a shift closure
            isShiftClosure = true
            logInfo(`Deletion is part of known active shift closure for shift ${shiftId}`)
          }
        }
      }

      // 2. If not already identified as shift closure, check for bulk deletion pattern
      if (!isShiftClosure) {
        // Check if this is likely a single product deletion
        const singleProductCheckResult = await isSingleProductDeletion(pool, folio)
        isSingleProductDeletion = singleProductCheckResult

        // Only run the more expensive bulk deletion check if this doesn't look like a single product deletion
        if (!isSingleProductDeletion) {
          // Check if this is part of a bulk deletion (which happens during shift closure)
          const isBulkDeletion = await isBulkDeletionInProgress(pool, folio)
          if (isBulkDeletion) {
            isShiftClosure = true
            logInfo(`Detected bulk deletion pattern for folio ${folio}, likely shift closure`)
          }
        }
      }

      // 3. If we've identified this as a shift closure, filter it out
      if (isShiftClosure) {
        // This deletion is part of a shift closure, skip it
        await markEventAsSuccess(pool, 'ProductEvents', id, 'Filtered: Product deletion during shift closure')

        const closureFilterTime = new Date() - startTime
        logInfo(`Filtered product deletion event ID ${id}: shift/bulk closure detected. Operation took ${closureFilterTime}ms`)
        return
      } else {
        // Log that we're processing this as a normal deletion
        logInfo(`Processing as normal product deletion (not part of shift closure)`)
      }
    }

    // Normal processing for non-filtered events
    const messageObject = {
      venueId: getConfig().VenueId
    }

    // Basic properties
    if (folio) messageObject.ticket = folio
    if (row.TableNumber) messageObject.table = row.TableNumber
    if (row.OrderNumber) messageObject.order = parseInt(row.OrderNumber, 10)
    if (status) messageObject.status = status

    // Product-specific properties
    if (row.IdProducto) messageObject.idproducto = row.IdProducto
    if (row.NombreProducto) messageObject.nombre = row.NombreProducto
    if (row.Movimiento) messageObject.movimiento = row.Movimiento
    if (row.Cantidad) messageObject.cantidad = parseFloat(row.Cantidad)
    if (row.Precio) messageObject.precio = parseFloat(row.Precio)
    if (row.Descuento) messageObject.descuento = parseFloat(row.Descuento)
    if (row.Hora) messageObject.hora = row.Hora
    if (row.Modificador) messageObject.modificador = row.Modificador
    if (row.Clasificacion) messageObject.clasificacion = row.Clasificacion

    // Common properties
    if (row.WaiterId) messageObject.idWaiter = row.WaiterId
    if (row.WaiterName) messageObject.waiterName = row.WaiterName
    if (row.IsSplitTable) messageObject.isSplitTable = Boolean(row.IsSplitTable)
    if (row.MainTable) messageObject.mainTable = row.MainTable
    if (row.SplitSuffix) messageObject.splitSuffix = row.SplitSuffix
    if (operationType) messageObject.operation = operationType

    // Add product's unique code
    if (row.UniqueCode) messageObject.uniqueCodeFromPos = row.UniqueCode

    // Add bill's unique code
    if (row.uniqueBillCodeFromPos) messageObject.uniqueBillCodeFromPos = row.uniqueBillCodeFromPos

    const preparationTime = new Date() - startTime

    // Publish to RabbitMQ
    const publishStartTime = new Date()
    const publishResult = await publishEvent('ProductEvents', messageObject)
    const publishTime = new Date() - publishStartTime
    trackPerformanceStat('RabbitMQ_Publish', publishTime)

    if (publishResult.success) {
      await markEventAsSuccess(pool, 'ProductEvents', id, publishResult.message)
    } else {
      await markEventAsFailed(pool, 'ProductEvents', id, publishResult.message)
    }

    const totalTime = new Date() - startTime
    logInfo(`Product event ID ${id} processed: ${preparationTime}ms prep, ${publishTime}ms RabbitMQ, ${totalTime}ms total`)
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing product event ID ${id}: ${error.message}. Operation took ${errorTime}ms`)
    await markEventAsFailed(pool, 'ProductEvents', id, error.message)
  }
}

/**
 * Process payment events
 */
async function processPaymentEvents(pool) {
  const startTime = new Date()
  let foundEvents = false

  try {
    // SQL query to get pending payment events
    const sql = `
      SELECT TOP 20 * FROM PaymentEvents WITH (NOLOCK) 
      WHERE UpdateDate IS NULL
    `

    // Execute query
    const result = await pool.request().query(sql)
    const queryTime = new Date() - startTime
    trackPerformanceStat('DB_Query', queryTime)

    if (result.recordset && result.recordset.length > 0) {
      const rowCount = result.recordset.length
      logInfo(`Processing ${rowCount} PaymentEvents (query took ${queryTime}ms)`)
      foundEvents = true

      const processingStartTime = new Date()
      let processedCount = 0

      // Process each row
      for (const row of result.recordset) {
        const rowStartTime = new Date()

        await processPaymentEvent(pool, row)
        processedCount++

        const rowProcessTime = new Date() - rowStartTime
        trackPerformanceStat('Processing', rowProcessTime)

        // Log every 5th row to avoid excessive logging
        if (processedCount % 5 === 0 || processedCount === rowCount) {
          logInfo(`Processed ${processedCount}/${rowCount} PaymentEvents rows. Last row took ${rowProcessTime}ms`)
        }
      }

      const totalProcessingTime = new Date() - processingStartTime
      logInfo(`Completed processing ${rowCount} PaymentEvents in ${totalProcessingTime}ms`)
    }

    const totalOperationTime = new Date() - startTime
    if (foundEvents) {
      logInfo(`Total PaymentEvents processing operation took ${totalOperationTime}ms`)
    } else {
      logDebug(`No PaymentEvents found. Query took ${queryTime}ms`)
    }
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing PaymentEvents: ${error.message}. Operation took ${errorTime}ms`)
  }

  return foundEvents
}

/**
 * Process a single payment event
 */
async function processPaymentEvent(pool, row) {
  const startTime = new Date()
  const id = row.ID
  logDebug(`Processing payment event ID ${id}`)

  try {
    // Build message object for payments
    const messageObject = {
      venueId: getConfig().VenueId
    }

    // Basic properties
    if (row.Folio) messageObject.folio = row.Folio
    if (row.IdFormaDePago) messageObject.idFormaDePago = row.IdFormaDePago

    // Numeric properties
    if (row.Importe) messageObject.importe = parseFloat(row.Importe)
    if (row.Propina) messageObject.propina = parseFloat(row.Propina)

    // Other properties
    if (row.Referencia) messageObject.referencia = row.Referencia
    if (row.WorkspaceId) messageObject.uniqueCodeFromPos = row.WorkspaceId
    if (row.UniqueBillCodePos) messageObject.uniqueBillCodePos = row.UniqueBillCodePos
    if (row.Method) messageObject.method = row.Method
    if (row.TableNumber) messageObject.table = row.TableNumber

    if (row.OrderNumber) messageObject.order = parseInt(row.OrderNumber, 10)

    if (row.IsSplitTable !== undefined) messageObject.is_split_table = Boolean(row.IsSplitTable)
    if (row.MainTable) messageObject.main_table = row.MainTable
    if (row.SplitSuffix) messageObject.split_suffix = row.SplitSuffix
    if (row.Status) messageObject.status = row.Status
    if (row.OperationType) messageObject.operation = row.OperationType

    const preparationTime = new Date() - startTime

    // Publish to RabbitMQ
    const publishStartTime = new Date()
    const publishResult = await publishEvent('PaymentEvents', messageObject)
    const publishTime = new Date() - publishStartTime
    trackPerformanceStat('RabbitMQ_Publish', publishTime)

    if (publishResult.success) {
      await markEventAsSuccess(pool, 'PaymentEvents', id, publishResult.message)
    } else {
      await markEventAsFailed(pool, 'PaymentEvents', id, publishResult.message)
    }

    const totalTime = new Date() - startTime
    logInfo(`Payment event ID ${id} processed: ${preparationTime}ms prep, ${publishTime}ms RabbitMQ, ${totalTime}ms total`)
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing payment event ID ${id}: ${error.message}. Operation took ${errorTime}ms`)
    await markEventAsFailed(pool, 'PaymentEvents', id, error.message)
  }
}

/**
 * Process turno (shift) events
 */
async function processTurnoEvents(pool) {
  const startTime = new Date()
  let foundEvents = false

  try {
    // SQL query to get pending turno events
    const sql = `
      SELECT TOP 20 * FROM TurnoEvents WITH (NOLOCK) 
      WHERE UpdateDate IS NULL
    `

    // Execute query
    const result = await pool.request().query(sql)
    const queryTime = new Date() - startTime
    trackPerformanceStat('DB_Query', queryTime)

    if (result.recordset && result.recordset.length > 0) {
      const rowCount = result.recordset.length
      logInfo(`Processing ${rowCount} TurnoEvents (query took ${queryTime}ms)`)
      foundEvents = true

      const processingStartTime = new Date()
      let processedCount = 0

      // Process each row
      for (const row of result.recordset) {
        const rowStartTime = new Date()

        await processTurnoEvent(pool, row)
        processedCount++

        const rowProcessTime = new Date() - rowStartTime
        trackPerformanceStat('Processing', rowProcessTime)

        // Log every 5th row to avoid excessive logging
        if (processedCount % 5 === 0 || processedCount === rowCount) {
          logInfo(`Processed ${processedCount}/${rowCount} TurnoEvents rows. Last row took ${rowProcessTime}ms`)
        }
      }

      const totalProcessingTime = new Date() - processingStartTime
      logInfo(`Completed processing ${rowCount} TurnoEvents in ${totalProcessingTime}ms`)
    }

    const totalOperationTime = new Date() - startTime
    if (foundEvents) {
      logInfo(`Total TurnoEvents processing operation took ${totalOperationTime}ms`)
    } else {
      logDebug(`No TurnoEvents found. Query took ${queryTime}ms`)
    }
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing TurnoEvents: ${error.message}. Operation took ${errorTime}ms`)
  }

  return foundEvents
}

/**
 * Process a single turno (shift) event
 */
async function processTurnoEvent(pool, row) {
  const startTime = new Date()
  const id = row.ID
  logDebug(`Processing turno event ID ${id}`)

  try {
    // Check if this is a shift closure event
    const status = row.Status
    const operationType = row.OperationType

    if (status === 'TURNO_UPDATED' && operationType === 'UPDATE' && row.Cierre) {
      // This appears to be a shift closure
      const shiftId = row.IdTurno

      // Record this shift as being closed - keep it in memory
      activeShiftClosures.set(shiftId, new Date())
      logInfo(`SHIFT CLOSURE DETECTED: Shift ID ${shiftId} is now closed - filtering product deletions`)
    }

    // Build message object for turnos
    const messageObject = {
      venueId: getConfig().VenueId
    }

    // Turno-specific properties
    if (row.IdTurnoInterno) messageObject.idturnointerno = parseInt(row.IdTurnoInterno, 10)
    if (row.IdTurno) messageObject.idturno = parseInt(row.IdTurno, 10)
    if (row.Fondo) messageObject.fondo = parseFloat(row.Fondo)

    // Date handling
    if (row.Apertura) {
      const apertura = new Date(row.Apertura)
      messageObject.apertura = apertura.toISOString()
    }

    if (row.Cierre) {
      const cierre = new Date(row.Cierre)
      messageObject.cierre = cierre.toISOString()
    } else {
      messageObject.cierre = null
    }

    if (row.Cajero) messageObject.cajero = row.Cajero
    if (row.Efectivo) messageObject.efectivo = parseFloat(row.Efectivo)
    if (row.Tarjeta) messageObject.tarjeta = parseFloat(row.Tarjeta)
    if (row.Vales) messageObject.vales = parseFloat(row.Vales)
    if (row.Credito) messageObject.credito = parseFloat(row.Credito)
    if (row.CorteEnviado !== undefined) messageObject.corte_enviado = Boolean(row.CorteEnviado)
    if (operationType) messageObject.operation = operationType

    const preparationTime = new Date() - startTime

    // Publish to RabbitMQ
    const publishStartTime = new Date()
    const publishResult = await publishEvent('TurnoEvents', messageObject)
    const publishTime = new Date() - publishStartTime
    trackPerformanceStat('RabbitMQ_Publish', publishTime)

    if (publishResult.success) {
      await markEventAsSuccess(pool, 'TurnoEvents', id, publishResult.message)
    } else {
      await markEventAsFailed(pool, 'TurnoEvents', id, publishResult.message)
    }

    const totalTime = new Date() - startTime
    logInfo(`Turno event ID ${id} processed: ${preparationTime}ms prep, ${publishTime}ms RabbitMQ, ${totalTime}ms total`)
  } catch (error) {
    const errorTime = new Date() - startTime
    logError(`Error processing turno event ID ${id}: ${error.message}. Operation took ${errorTime}ms`)
    await markEventAsFailed(pool, 'TurnoEvents', id, error.message)
  }
}

/**
 * Helper methods
 */

// Get shift ID for a folio
async function getShiftIdForFolio(pool, folio) {
  if (!folio) return 0

  try {
    const result = await pool.request().input('Folio', folio).query(`
        SELECT idturno 
        FROM tempcheques WITH (NOLOCK) 
        WHERE folio = @Folio
      `)

    if (result.recordset && result.recordset.length > 0 && result.recordset[0].idturno) {
      return result.recordset[0].idturno
    }
  } catch (error) {
    logError(`Error looking up shift ID for folio ${folio}: ${error.message}`)
  }

  return 0
}

// Check for bulk ticket deletion pattern
async function isBulkTicketDeletionInProgress(pool) {
  try {
    // Check for many deletions in a short time
    const deletionResult = await pool.request().query(`
      SELECT COUNT(*) AS count
      FROM TicketEvents WITH (NOLOCK)
      WHERE EventType = 'DELETED'
        AND OperationType = 'DELETE'
        AND IsProcessed = 0
        AND CreateDate >= DATEADD(SECOND, -30, GETDATE())
    `)

    if (deletionResult.recordset && deletionResult.recordset[0].count > 8) {
      logInfo(`Detected high volume of ticket deletions: ${deletionResult.recordset[0].count} tickets deleted in the last 30 seconds`)
      return true
    }

    // Also check for active shift closures
    const shiftResult = await pool.request().query(`
      SELECT COUNT(*) AS count
      FROM TurnoEvents WITH (NOLOCK)
      WHERE Status = 'TURNO_UPDATED'
        AND Cierre IS NOT NULL
        AND CreateDate >= DATEADD(MINUTE, -5, GETDATE())
    `)

    if (shiftResult.recordset && shiftResult.recordset[0].count > 0) {
      logInfo(`Detected active shift closing operations: ${shiftResult.recordset[0].count} in the last 5 minutes`)
      return true
    }
  } catch (error) {
    logError(`Error checking for bulk ticket deletion pattern: ${error.message}`)
  }

  return false
}

// Check if this is a single product deletion
async function isSingleProductDeletion(pool, folio) {
  try {
    const result = await pool.request().input('Folio', folio).query(`
        SELECT COUNT(*) AS count
        FROM ProductEvents WITH (NOLOCK)
        WHERE Folio = @Folio 
          AND Status = 'PRODUCT_REMOVED'
          AND OperationType = 'DELETE'
          AND CreateDate >= DATEADD(SECOND, -5, GETDATE())
      `)

    // If it's just 1 or 2 products being deleted, it's likely a regular deletion
    if (result.recordset && result.recordset[0].count <= 2) {
      logInfo(`Detected single/few item deletion pattern for folio ${folio}`)
      return true
    }
  } catch (error) {
    logError(`Error checking for single product deletion: ${error.message}`)
  }

  return false
}

// Check for bulk deletion pattern
async function isBulkDeletionInProgress(pool, folio) {
  // We'll consider it a bulk deletion only if multiple conditions are met
  let manyDeletionsForSameFolio = false
  let manyDifferentFolios = false
  let manyTicketChanges = false

  try {
    // Check if there are many deletions for this folio in the last few seconds
    const sameFolioResult = await pool.request().input('Folio', folio).query(`
        SELECT COUNT(*) AS count
        FROM ProductEvents WITH (NOLOCK)
        WHERE Folio = @Folio 
          AND Status = 'PRODUCT_REMOVED'
          AND OperationType = 'DELETE'
          AND CreateDate >= DATEADD(SECOND, -10, GETDATE())
      `)

    // If we have many deletions for the same folio in a short time
    if (sameFolioResult.recordset && sameFolioResult.recordset[0].count > 10) {
      manyDeletionsForSameFolio = true
      logInfo(`Detected high volume of deletions: ${sameFolioResult.recordset[0].count} products removed from folio ${folio} in the last 10 seconds`)
    }

    // Check if there are deletions happening across multiple folios
    const differentFoliosResult = await pool.request().query(`
      SELECT COUNT(DISTINCT Folio) AS count
      FROM ProductEvents WITH (NOLOCK)
      WHERE Status = 'PRODUCT_REMOVED'
        AND OperationType = 'DELETE'
        AND UpdateDate IS NULL
        AND CreateDate >= DATEADD(SECOND, -10, GETDATE())
    `)

    // If many different folios have deletion events
    if (differentFoliosResult.recordset && differentFoliosResult.recordset[0].count > 6) {
      manyDifferentFolios = true
      logInfo(`Detected deletions across multiple folios: ${differentFoliosResult.recordset[0].count} different folios with removals in the last 10 seconds`)
    }

    // Additional check - look for corresponding ticket events that indicate tables being cleared
    const ticketChangesResult = await pool.request().query(`
      SELECT COUNT(*) AS count
      FROM TicketEvents WITH (NOLOCK)
      WHERE (EventType = 'DELETED' OR EventType = 'PAID')
        AND CreateDate >= DATEADD(SECOND, -30, GETDATE())
    `)

    // If we're also seeing many ticket status changes in the same timeframe
    if (ticketChangesResult.recordset && ticketChangesResult.recordset[0].count > 8) {
      manyTicketChanges = true
      logInfo(`Detected ${ticketChangesResult.recordset[0].count} tickets being closed or deleted recently`)
    }

    // Add additional check for active shift closing operations in progress
    let activeShiftClosingOperation = false
    const shiftClosingResult = await pool.request().query(`
      SELECT COUNT(*) AS count
      FROM TurnoEvents WITH (NOLOCK)
      WHERE Status = 'TURNO_UPDATED'
        AND Cierre IS NOT NULL
        AND CreateDate >= DATEADD(MINUTE, -5, GETDATE())
    `)

    if (shiftClosingResult.recordset && shiftClosingResult.recordset[0].count > 0) {
      activeShiftClosingOperation = true
      logInfo(`Detected active shift closing operations: ${shiftClosingResult.recordset[0].count} in the last 5 minutes`)
    }

    // We now require multiple conditions to be true instead of just one
    if ((manyDeletionsForSameFolio && manyTicketChanges) || (manyDifferentFolios && manyTicketChanges) || (activeShiftClosingOperation && (manyDeletionsForSameFolio || manyDifferentFolios))) {
      logInfo('Multiple shift closure indicators detected - classifying as shift closure')
      return true
    }
  } catch (error) {
    logError(`Error checking for bulk deletion pattern: ${error.message}`)
  }

  return false
}

// Clean up shift closure cache
function cleanupShiftClosureCache() {
  const keysToRemove = []

  // Keep closed shifts in memory for 10 minutes
  // to ensure we catch deletions that happen later in the process
  const EXTENDED_TIMEOUT = SHIFT_CLOSURE_TIMEOUT_MINUTES

  for (const [key, timestamp] of activeShiftClosures.entries()) {
    if ((new Date() - timestamp) / (1000 * 60) >= EXTENDED_TIMEOUT) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    activeShiftClosures.delete(key)
    logInfo(`Removed expired shift closure tracking for shift ${key} after ${EXTENDED_TIMEOUT} minutes`)
  }
}

// Adjust polling interval based on activity
function adjustPollingInterval(foundEvents, pollingConfig) {
  if (foundEvents) {
    // If we found events, poll more frequently
    currentPollingInterval = pollingConfig.minPollingIntervalMs
    lastPollFoundEvents = true
  } else {
    // If we didn't find events this time or last time, back off
    if (!lastPollFoundEvents) {
      currentPollingInterval = Math.min(currentPollingInterval + pollingConfig.pollingBackoffMs, pollingConfig.maxPollingIntervalMs)
    }
    lastPollFoundEvents = false
  }
}

// Track performance statistics
function trackPerformanceStat(category, milliseconds) {
  if (performanceStats[category]) {
    performanceStats[category].push(milliseconds)

    // Keep the list from growing too large
    if (performanceStats[category].length > 1000) {
      performanceStats[category].shift()
    }
  }
}

// Output performance report
function outputPerformanceReport() {
  const report = ['=============== PERFORMANCE REPORT ===============']

  for (const [category, stats] of Object.entries(performanceStats)) {
    if (stats.length > 0) {
      // Calculate statistics
      const avg = stats.reduce((sum, val) => sum + val, 0) / stats.length
      const min = Math.min(...stats)
      const max = Math.max(...stats)
      const median = calculateMedian(stats)
      const p95 = calculatePercentile(stats, 95)

      report.push(`${category}:`)
      report.push(`  Count: ${stats.length}`)
      report.push(`  Avg: ${avg.toFixed(2)}ms`)
      report.push(`  Min: ${min.toFixed(2)}ms`)
      report.push(`  Max: ${max.toFixed(2)}ms`)
      report.push(`  Median: ${median.toFixed(2)}ms`)
      report.push(`  95th %: ${p95.toFixed(2)}ms`)
    }
  }

  report.push('===================================================')

  // Always log performance report
  logInfo(report.join('\n'))

  // Clear stats after reporting
  for (const category in performanceStats) {
    performanceStats[category] = []
  }
}

// Calculate median of a list
function calculateMedian(values) {
  if (!values || values.length === 0) return 0

  const sortedValues = [...values].sort((a, b) => a - b)
  const count = sortedValues.length

  if (count % 2 === 0) {
    return (sortedValues[count / 2 - 1] + sortedValues[count / 2]) / 2
  } else {
    return sortedValues[Math.floor(count / 2)]
  }
}

// Calculate percentile of a list
function calculatePercentile(values, percentile) {
  if (!values || values.length === 0) return 0

  const sortedValues = [...values].sort((a, b) => a - b)
  const count = sortedValues.length

  const rank = (percentile / 100) * (count - 1)
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)

  if (lowerIndex === upperIndex) return sortedValues[lowerIndex]

  const weight = rank - lowerIndex
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
}

// Mark event as successful
async function markEventAsSuccess(pool, tableName, id, response) {
  try {
    let sql

    if (tableName === 'TicketEvents') {
      sql = `
        UPDATE ${tableName} SET 
        IsProcessed = 1, ProcessedDate = @ProcessedDate, Response = @Response, UpdateDate = @UpdateDate 
        WHERE ID = @Id
      `
    } else {
      sql = `
        UPDATE ${tableName} SET 
        IsSuccess = 1, IsFailed = 0, Response = @Response, UpdateDate = @UpdateDate 
        WHERE ID = @Id
      `
    }

    await pool.request().input('Response', response).input('ProcessedDate', new Date()).input('UpdateDate', new Date()).input('Id', id).query(sql)

    logDebug(`Updated ${tableName} record ${id} as success`)
    return true
  } catch (error) {
    logError(`Error marking event as success: ${error.message}`)
    return false
  }
}

// Mark event as failed
async function markEventAsFailed(pool, tableName, id, errorMessage) {
  try {
    let sql

    if (tableName === 'TicketEvents') {
      sql = `
        UPDATE ${tableName} SET 
        IsProcessed = 1, ProcessedDate = @ProcessedDate, Response = @Response, UpdateDate = @UpdateDate 
        WHERE ID = @Id
      `
    } else {
      sql = `
        UPDATE ${tableName} SET 
        IsSuccess = 0, IsFailed = 1, Response = @Response, UpdateDate = @UpdateDate 
        WHERE ID = @Id
      `
    }

    await pool.request().input('Response', errorMessage).input('ProcessedDate', new Date()).input('UpdateDate', new Date()).input('Id', id).query(sql)

    logDebug(`Updated ${tableName} record ${id} as failed`)
    return true
  } catch (error) {
    logError(`Error marking event as failed: ${error.message}`)
    return false
  }
}

export default {
  initDatabasePoller
}
