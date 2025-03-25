// src/services/database/change-tracking.js
import sql from 'mssql'
import { logInfo, logError, logDebug } from '../../utils/logger.js'
import { publishEvent } from '../rabbitmq/publisher.js'
import 'dotenv/config'

// Connection pool (will be initialized)
let pool = null

// Track last change version for each table
const lastChangeVersions = {
  TicketEvents: 0,
  ProductEvents: 0,
  PaymentEvents: 0,
  TurnoEvents: 0
}

// Cache of recently processed events to prevent duplicates
const processedEventsCache = {
  TicketEvents: new Set(),
  ProductEvents: new Set(),
  PaymentEvents: new Set(),
  TurnoEvents: new Set()
}

// Maximum size for the cache
const MAX_CACHE_SIZE = 1000

// Cache TTL in milliseconds (30 minutes)
const CACHE_TTL = 30 * 60 * 1000

// Interval for checking changes (in milliseconds)
const CHECK_INTERVAL = 2000

// Venue ID from config
let venueId = process.env.VENUE_ID || 'madre_cafecito'

// Flag to control the monitor
let isRunning = false

/**
 * Initialize change tracking in the database
 */
export async function setupChangeTracking(dbPool, configuredVenueId) {
  try {
    pool = dbPool
    if (configuredVenueId) {
      venueId = configuredVenueId
    }

    // Enable change tracking on the database if not already enabled
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id = DB_ID())
      BEGIN
        ALTER DATABASE CURRENT SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 2 DAYS, AUTO_CLEANUP = ON)
      END
    `)

    // Enable change tracking on each table that needs to be tracked
    await enableTableChangeTracking('TicketEvents')
    await enableTableChangeTracking('ProductEvents')
    await enableTableChangeTracking('PaymentEvents')
    await enableTableChangeTracking('TurnoEvents')

    // Get current change tracking version for each table
    await initializeChangeVersions()

    // Set up cache cleanup
    setInterval(cleanupCache, CACHE_TTL / 2)

    logInfo('Change tracking has been set up successfully')
    return true
  } catch (error) {
    logError(`Error setting up change tracking: ${error.message}`)
    return false
  }
}

/**
 * Enable change tracking for a specific table
 */
async function enableTableChangeTracking(tableName) {
  try {
    // Check if change tracking is already enabled for this table
    const result = await pool.request().input('tableName', sql.NVarChar, tableName).query(`
        SELECT OBJECT_ID(@tableName) AS TableId,
               OBJECTPROPERTYEX(OBJECT_ID(@tableName), 'TableHasChangeTracking') AS HasChangeTracking
      `)

    const tableId = result.recordset[0]?.TableId
    const hasChangeTracking = result.recordset[0]?.HasChangeTracking

    if (!tableId) {
      logError(`Table ${tableName} does not exist in the database`)
      return false
    }

    if (hasChangeTracking !== 1) {
      // Enable change tracking on the table
      await pool.request().input('tableName', sql.NVarChar, tableName).query(`
          ALTER TABLE ${tableName} ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
        `)

      logInfo(`Change tracking enabled for table ${tableName}`)
    } else {
      logDebug(`Change tracking already enabled for table ${tableName}`)
    }

    return true
  } catch (error) {
    logError(`Error enabling change tracking for ${tableName}: ${error.message}`)
    return false
  }
}

/**
 * Initialize the last change versions for all tables
 */
async function initializeChangeVersions() {
  try {
    // Get the current database change tracking version
    const versionResult = await pool.request().query(`
      SELECT CHANGE_TRACKING_CURRENT_VERSION() AS CurrentVersion
    `)

    const currentVersion = versionResult.recordset[0].CurrentVersion

    // Initialize all tables with this version
    Object.keys(lastChangeVersions).forEach((table) => {
      lastChangeVersions[table] = currentVersion
    })

    logInfo(`Initialized change tracking at version ${currentVersion}`)
    return true
  } catch (error) {
    logError(`Error initializing change versions: ${error.message}`)
    return false
  }
}

/**
 * Cleanup the deduplication cache to prevent memory leaks
 */
function cleanupCache() {
  try {
    const now = Date.now()
    let totalRemoved = 0

    for (const tableName of Object.keys(processedEventsCache)) {
      const cache = processedEventsCache[tableName]

      // If cache exceeds maximum size, clear older entries
      if (cache.size > MAX_CACHE_SIZE) {
        const oldSize = cache.size
        processedEventsCache[tableName] = new Set()
        totalRemoved += oldSize
        logInfo(`Cleared ${oldSize} entries from ${tableName} cache due to size limit`)
      }
    }

    if (totalRemoved > 0) {
      logInfo(`Cache cleanup complete: removed ${totalRemoved} entries`)
    }
  } catch (error) {
    logError(`Error cleaning up cache: ${error.message}`)
  }
}

/**
 * Start monitoring for database changes
 */
export function startChangeTracking() {
  if (isRunning) {
    logInfo('Change tracking monitor is already running')
    return
  }

  isRunning = true

  // Initial check
  checkForChanges()

  // Schedule regular checks
  const intervalId = setInterval(() => {
    if (!isRunning) {
      clearInterval(intervalId)
      return
    }

    checkForChanges().catch((error) => {
      logError(`Error in change tracking check: ${error.message}`)
    })
  }, CHECK_INTERVAL)

  logInfo(`Change tracking monitor started with ${CHECK_INTERVAL}ms interval`)
}

/**
 * Stop monitoring for database changes
 */
export function stopChangeTracking() {
  isRunning = false
  logInfo('Change tracking monitor stopped')
}

/**
 * Check for changes in all tracked tables
 */
async function checkForChanges() {
  if (!pool) {
    logError('Database pool not initialized')
    return
  }

  try {
    // Process changes for each table type - using Promise.all for parallel processing
    const results = await Promise.all([processTicketChanges(), processProductChanges(), processPaymentChanges(), processTurnoChanges()])

    // Log overall results
    const totalChangesFound = results.filter((result) => result).length
    if (totalChangesFound > 0) {
      logDebug(`Processed changes in ${totalChangesFound} tables`)
    }
  } catch (error) {
    logError(`Error checking for changes: ${error.message}`)
  }
}

/**
 * Process changes in the TicketEvents table
 */
async function processTicketChanges() {
  const tableName = 'TicketEvents'
  try {
    // Get changes since last version
    const result = await pool.request().input('lastVersion', sql.BigInt, lastChangeVersions[tableName]).query(`
        SELECT t.*, CT.SYS_CHANGE_OPERATION, CT.SYS_CHANGE_VERSION
        FROM CHANGETABLE(CHANGES ${tableName}, @lastVersion) AS CT
        JOIN ${tableName} t ON t.ID = CT.ID
        WHERE CT.SYS_CHANGE_OPERATION IN ('I', 'U')
        AND t.IsProcessed = 0
        ORDER BY CT.SYS_CHANGE_VERSION
      `)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} ticket changes to process`)

    let newVersion = lastChangeVersions[tableName]
    let processedCount = 0
    const cache = processedEventsCache[tableName]

    for (const row of result.recordset) {
      try {
        // Update highest change version seen
        if (row.SYS_CHANGE_VERSION > newVersion) {
          newVersion = row.SYS_CHANGE_VERSION
        }

        // Create a unique identifier for this event to prevent duplicates
        const eventKey = `${row.ID}-${row.EventType}-${row.Folio}`

        // Skip if we've already processed this exact event recently
        if (cache.has(eventKey)) {
          logDebug(`Skipping already processed event: ${eventKey}`)

          // Still mark it as processed in the database
          const now = new Date().toISOString()
          await pool.request().input('processedDate', sql.DateTimeOffset, now).input('response', sql.NVarChar, 'Skipped - duplicate event').input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID)
            .query(`
              UPDATE TicketEvents 
              SET IsProcessed = 1, 
                  ProcessedDate = @processedDate, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
          continue
        }

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
        const publishResult = await publishEvent('TicketEvents', message)

        // Mark as processed in database
        const now = new Date().toISOString()
        const response = publishResult ? 'Published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('processedDate', sql.DateTimeOffset, now).input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
            UPDATE TicketEvents 
            SET IsProcessed = 1, 
                ProcessedDate = @processedDate, 
                Response = @response, 
                UpdateDate = @updateDate 
            WHERE ID = @id
          `)

        // Add to cache to prevent duplicate processing
        cache.add(eventKey)
        processedCount++

        logDebug(`Processed ticket event ${row.ID} (${row.EventType}) via change tracking`)
      } catch (error) {
        logError(`Error processing ticket event ${row.ID}: ${error.message}`)

        // Try to mark as processed anyway to avoid infinite retries
        try {
          const now = new Date().toISOString()
          await pool.request().input('processedDate', sql.DateTimeOffset, now).input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE TicketEvents 
              SET IsProcessed = 1, 
                  ProcessedDate = @processedDate, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
        } catch (updateError) {
          logError(`Failed to mark ticket event ${row.ID} as processed: ${updateError.message}`)
        }
      }
    }

    // Update last version if changes were found
    if (newVersion > lastChangeVersions[tableName]) {
      lastChangeVersions[tableName] = newVersion
      logInfo(`Updated last change version for ${tableName} to ${newVersion}`)
    }

    logInfo(`Successfully processed ${processedCount} of ${result.recordset.length} ticket events`)
    return processedCount > 0
  } catch (error) {
    logError(`Error processing ${tableName} changes: ${error.message}`)
    return false
  }
}

/**
 * Process changes in the ProductEvents table
 */
async function processProductChanges() {
  const tableName = 'ProductEvents'
  try {
    // Get changes since last version
    const result = await pool.request().input('lastVersion', sql.BigInt, lastChangeVersions[tableName]).query(`
        SELECT p.*, CT.SYS_CHANGE_OPERATION, CT.SYS_CHANGE_VERSION
        FROM CHANGETABLE(CHANGES ${tableName}, @lastVersion) AS CT
        JOIN ${tableName} p ON p.ID = CT.ID
        WHERE CT.SYS_CHANGE_OPERATION IN ('I', 'U')
          AND p.UpdateDate IS NULL
        ORDER BY CT.SYS_CHANGE_VERSION
      `)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} product changes to process`)

    let newVersion = lastChangeVersions[tableName]
    let processedCount = 0
    const cache = processedEventsCache[tableName]

    for (const row of result.recordset) {
      try {
        // Update highest change version seen
        if (row.SYS_CHANGE_VERSION > newVersion) {
          newVersion = row.SYS_CHANGE_VERSION
        }

        // Create a unique identifier for this event to prevent duplicates
        const eventKey = `${row.ID}-${row.Status}-${row.Folio}-${row.IdProducto}`

        // Skip if we've already processed this exact event recently
        if (cache.has(eventKey)) {
          logDebug(`Skipping already processed product event: ${eventKey}`)

          // Still mark it as processed in the database
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, 'Skipped - duplicate event').input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE ProductEvents 
              SET IsSuccess = 1, 
                  IsFailed = 0, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
          continue
        }

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
        const publishResult = await publishEvent('ProductEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = publishResult ? 'Published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
            UPDATE ProductEvents 
            SET IsSuccess = 1, 
                IsFailed = 0, 
                Response = @response, 
                UpdateDate = @updateDate 
            WHERE ID = @id
          `)

        // Add to cache to prevent duplicate processing
        cache.add(eventKey)
        processedCount++

        logDebug(`Processed product event ${row.ID} via change tracking`)
      } catch (error) {
        logError(`Error processing product event ${row.ID}: ${error.message}`)

        // Mark as failed
        try {
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE ProductEvents 
              SET IsSuccess = 0, 
                  IsFailed = 1, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
        } catch (updateError) {
          logError(`Failed to mark product event ${row.ID} as failed: ${updateError.message}`)
        }
      }
    }

    // Update last version if changes were found
    if (newVersion > lastChangeVersions[tableName]) {
      lastChangeVersions[tableName] = newVersion
      logInfo(`Updated last change version for ${tableName} to ${newVersion}`)
    }

    logInfo(`Successfully processed ${processedCount} of ${result.recordset.length} product events`)
    return processedCount > 0
  } catch (error) {
    logError(`Error processing ${tableName} changes: ${error.message}`)
    return false
  }
}

/**
 * Process changes in the PaymentEvents table
 */
async function processPaymentChanges() {
  const tableName = 'PaymentEvents'
  try {
    // Get changes since last version
    const result = await pool.request().input('lastVersion', sql.BigInt, lastChangeVersions[tableName]).query(`
        SELECT p.*, CT.SYS_CHANGE_OPERATION, CT.SYS_CHANGE_VERSION
        FROM CHANGETABLE(CHANGES ${tableName}, @lastVersion) AS CT
        JOIN ${tableName} p ON p.ID = CT.ID
        WHERE CT.SYS_CHANGE_OPERATION IN ('I', 'U')
          AND p.UpdateDate IS NULL
        ORDER BY CT.SYS_CHANGE_VERSION
      `)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} payment changes to process`)

    let newVersion = lastChangeVersions[tableName]
    let processedCount = 0
    const cache = processedEventsCache[tableName]

    for (const row of result.recordset) {
      try {
        // Update highest change version seen
        if (row.SYS_CHANGE_VERSION > newVersion) {
          newVersion = row.SYS_CHANGE_VERSION
        }

        // Create a unique identifier for this event to prevent duplicates
        const eventKey = `${row.ID}-${row.Status}-${row.Folio}-${row.IdFormaDePago}`

        // Skip if we've already processed this exact event recently
        if (cache.has(eventKey)) {
          logDebug(`Skipping already processed payment event: ${eventKey}`)

          // Still mark it as processed in the database
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, 'Skipped - duplicate event').input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE PaymentEvents 
              SET IsSuccess = 1, 
                  IsFailed = 0, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
          continue
        }

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
        const publishResult = await publishEvent('PaymentEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = publishResult ? 'Published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
            UPDATE PaymentEvents 
            SET IsSuccess = 1, 
                IsFailed = 0, 
                Response = @response, 
                UpdateDate = @updateDate 
            WHERE ID = @id
          `)

        // Add to cache to prevent duplicate processing
        cache.add(eventKey)
        processedCount++

        logDebug(`Processed payment event ${row.ID} via change tracking`)
      } catch (error) {
        logError(`Error processing payment event ${row.ID}: ${error.message}`)

        // Mark as failed
        try {
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE PaymentEvents 
              SET IsSuccess = 0, 
                  IsFailed = 1, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
        } catch (updateError) {
          logError(`Failed to mark payment event ${row.ID} as failed: ${updateError.message}`)
        }
      }
    }

    // Update last version if changes were found
    if (newVersion > lastChangeVersions[tableName]) {
      lastChangeVersions[tableName] = newVersion
      logInfo(`Updated last change version for ${tableName} to ${newVersion}`)
    }

    logInfo(`Successfully processed ${processedCount} of ${result.recordset.length} payment events`)
    return processedCount > 0
  } catch (error) {
    logError(`Error processing ${tableName} changes: ${error.message}`)
    return false
  }
}

/**
 * Process changes in the TurnoEvents table
 */
async function processTurnoChanges() {
  const tableName = 'TurnoEvents'
  try {
    // Get changes since last version
    const result = await pool.request().input('lastVersion', sql.BigInt, lastChangeVersions[tableName]).query(`
        SELECT t.*, CT.SYS_CHANGE_OPERATION, CT.SYS_CHANGE_VERSION
        FROM CHANGETABLE(CHANGES ${tableName}, @lastVersion) AS CT
        JOIN ${tableName} t ON t.ID = CT.ID
        WHERE CT.SYS_CHANGE_OPERATION IN ('I', 'U')
          AND t.UpdateDate IS NULL
        ORDER BY CT.SYS_CHANGE_VERSION
      `)

    if (result.recordset.length === 0) {
      return false
    }

    logInfo(`Found ${result.recordset.length} turno changes to process`)

    let newVersion = lastChangeVersions[tableName]
    let processedCount = 0
    const cache = processedEventsCache[tableName]

    for (const row of result.recordset) {
      try {
        // Update highest change version seen
        if (row.SYS_CHANGE_VERSION > newVersion) {
          newVersion = row.SYS_CHANGE_VERSION
        }

        // Create a unique identifier for this event to prevent duplicates
        const eventKey = `${row.ID}-${row.Status}-${row.IdTurno}`

        // Skip if we've already processed this exact event recently
        if (cache.has(eventKey)) {
          logDebug(`Skipping already processed turno event: ${eventKey}`)

          // Still mark it as processed in the database
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, 'Skipped - duplicate event').input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE TurnoEvents 
              SET IsSuccess = 1, 
                  IsFailed = 0, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
          continue
        }

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
        const publishResult = await publishEvent('TurnoEvents', message)

        // Mark as processed
        const now = new Date().toISOString()
        const response = publishResult ? 'Published to RabbitMQ' : 'Failed to publish to RabbitMQ'

        await pool.request().input('response', sql.NVarChar, response).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
            UPDATE TurnoEvents 
            SET IsSuccess = 1, 
                IsFailed = 0, 
                Response = @response, 
                UpdateDate = @updateDate 
            WHERE ID = @id
          `)

        // Add to cache to prevent duplicate processing
        cache.add(eventKey)
        processedCount++

        logDebug(`Processed turno event ${row.ID} via change tracking`)
      } catch (error) {
        logError(`Error processing turno event ${row.ID}: ${error.message}`)

        // Mark as failed
        try {
          const now = new Date().toISOString()
          await pool.request().input('response', sql.NVarChar, `Error: ${error.message}`).input('updateDate', sql.DateTimeOffset, now).input('id', sql.Int, row.ID).query(`
              UPDATE TurnoEvents 
              SET IsSuccess = 0, 
                  IsFailed = 1, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `)
        } catch (updateError) {
          logError(`Failed to mark turno event ${row.ID} as failed: ${updateError.message}`)
        }
      }
    }

    // Update last version if changes were found
    if (newVersion > lastChangeVersions[tableName]) {
      lastChangeVersions[tableName] = newVersion
      logInfo(`Updated last change version for ${tableName} to ${newVersion}`)
    }

    logInfo(`Successfully processed ${processedCount} of ${result.recordset.length} turno events`)
    return processedCount > 0
  } catch (error) {
    logError(`Error processing ${tableName} changes: ${error.message}`)
    return false
  }
}

export default {
  setupChangeTracking,
  startChangeTracking,
  stopChangeTracking
}
