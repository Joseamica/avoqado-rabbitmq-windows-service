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

// NEW: Track active split bill operations to deduplicate across related bills
const activeSplitOperations = new Map()

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
    
    // NEW: Set up split operation cleanup
    setInterval(cleanupSplitOperations, 5 * 60 * 1000)

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
 * NEW: Cleanup for split operations tracking
 */
function cleanupSplitOperations() {
  try {
    const now = Date.now()
    let count = 0
    
    for (const [key, operation] of activeSplitOperations.entries()) {
      if ((now - operation.startTime) > 10 * 60 * 1000) { // 10 minutes
        activeSplitOperations.delete(key)
        count++
      }
    }
    
    if (count > 0) {
      logInfo(`Cleaned up ${count} expired split operations`)
    }
  } catch (error) {
    logError(`Error cleaning up split operations: ${error.message}`)
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
        
        // Enhanced split bill handling
        if (row.EventType === 'SPLIT' || (row.IsSplitOperation === true || row.IsSplitOperation === 1)) {
          // Create a consistent key for the split operation
          // Gather all related bill numbers
          const components = []
          if (row.Folio) components.push(row.Folio)
          if (row.SplitFolios) components.push(...row.SplitFolios.split(',').map(f => f.trim()).filter(f => f))
          if (row.ParentFolio) components.push(row.ParentFolio)
          
          // Create a unique identifier for this split operation
          const uniqueBills = [...new Set(components)].sort()
          const splitOperationKey = `split-${venueId}-${uniqueBills.join('-')}`
          
          // Track this split operation for product deduplication
          if (!activeSplitOperations.has(splitOperationKey)) {
            activeSplitOperations.set(splitOperationKey, {
              startTime: Date.now(),
              parentBill: row.Folio,
              bills: uniqueBills,
              processedProducts: new Set(),
              // Track deletions specifically to allow them
              allowDeletions: true
            })
            
            logInfo(`Tracking new split operation: ${splitOperationKey} with bills: ${uniqueBills.join(', ')}`)
          }
          
          // Also store the split operation key in the event
          row.splitOperationKey = splitOperationKey
        }

        // Skip if we've already processed this exact event recently
        // BUT ALWAYS process DELETED events for bills - they should never be skipped
        // EXCEPT when ShiftState is CLOSED (part of shift closure)
        const isDeleteOperation = row.EventType === 'DELETED' || (row.OperationType === 'DELETE');
        const isShiftClosure = isDeleteOperation && row.ShiftState === 'CLOSED';
        
        // Skip deletions that are part of shift closure
        if (isShiftClosure) {
          logInfo(`Skipping bill deletion that is part of shift closure: ${row.Folio}`);
          
          // Mark as processed
          const now = new Date().toISOString();
          await pool.request()
            .input('processedDate', sql.DateTimeOffset, now)
            .input('response', sql.NVarChar, 'Skipped - part of shift closure')
            .input('updateDate', sql.DateTimeOffset, now)
            .input('id', sql.Int, row.ID)
            .query(`
              UPDATE TicketEvents 
              SET IsProcessed = 1, 
                  ProcessedDate = @processedDate, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `);
          continue;
        }
        
        if (cache.has(eventKey) && !isDeleteOperation) {
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
        
        // If this is a delete operation that would otherwise be skipped, log it
        if (cache.has(eventKey) && isDeleteOperation) {
          logInfo(`Processing bill deletion event despite cache hit: ${eventKey}`)
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
          uniqueCodeFromPos: row.UniqueCode,
          mainBillUniqueCodeForBillSplitting: row.MainBillUniqueCodeForBillSplitting
        }

        // Add financial data if available
        if (row.Descuento !== null) message.descuento = row.Descuento
        if (row.Total !== null) message.total = row.Total

        // Enhanced split operation details
        if (row.IsSplitOperation === true || row.IsSplitOperation === 1) {
          message.isSplit = true

          if (row.SplitRole === 'PARENT') {
            message.splitType = 'ORIGINAL'
            
            // Ensure splitFolios is clean by splitting and rejoining
            if (row.SplitFolios) {
              // Parse the SplitFolios into an array, removing duplicates and empty values
              const folios = [...new Set(row.SplitFolios.split(',').map(f => f.trim()).filter(f => f))]
              message.relatedFolio = folios.join(',')
            } else {
              message.relatedFolio = row.SplitFolios
            }
            
            message.splitTables = row.SplitTables
            
            // Store the split operation key for reference
            if (row.splitOperationKey) {
              message._splitOperationKey = row.splitOperationKey
            }
          } else if (row.SplitRole === 'CHILD') {
            message.splitType = 'NEW'
            message.relatedFolio = row.ParentFolio
            message.originalTable = row.OriginalTable
            
            // Store the split operation key for reference
            if (row.splitOperationKey) {
              message._splitOperationKey = row.splitOperationKey
            }
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
    
    // Track unique products within this processing batch to avoid duplicates
    const processedProductsInBatch = new Set()

    for (const row of result.recordset) {
      try {
        // Update highest change version seen
        if (row.SYS_CHANGE_VERSION > newVersion) {
          newVersion = row.SYS_CHANGE_VERSION
        }

        // Create deduplication keys
        const eventKey = `${row.ID}-${row.Status}-${row.Folio}-${row.IdProducto}`
        const productMovementKey = `${row.uniqueBillCodeFromPos || ''}-${row.IdProducto}-${row.Movimiento}-${row.Cantidad || ''}-${row.Status}`
        
        // Check if this is a deletion related to a shift closure
        const isDeleteOperation = row.Status === 'PRODUCT_REMOVED' || row.OperationType === 'DELETE' || row.Movimiento === -1;
        const isShiftClosure = isDeleteOperation && row.ShiftState === 'CLOSED';
        
        // Skip product deletions that are part of shift closure
        if (isShiftClosure) {
          logInfo(`Skipping product deletion that is part of shift closure: ${row.IdProducto} on bill ${row.Folio}`);
          
          // Mark as processed
          const now = new Date().toISOString();
          await pool.request()
            .input('response', sql.NVarChar, 'Skipped - product deletion during shift closure')
            .input('updateDate', sql.DateTimeOffset, now)
            .input('id', sql.Int, row.ID)
            .query(`
              UPDATE ProductEvents 
              SET IsSuccess = 1, 
                  IsFailed = 0, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `);
          continue;
        }
        
        // Special handling for split operations
        let isSplitOperation = false
        let splitOperationKey = null
        let shouldAllowDeletion = false
        
        // Check if this product is part of an active split operation
        if (row.IsSplitTable === true || row.IsSplitTable === 1 || row.MainTable) {
          // Look for active split operations that might contain this bill
          for (const [key, operation] of activeSplitOperations.entries()) {
            if (operation.bills.includes(row.Folio)) {
              isSplitOperation = true
              splitOperationKey = key
              
              // For deletions related to split operations, we need to process them
              if (row.Status === 'PRODUCT_REMOVED' && (row.OperationType === 'DELETE' || row.Movimiento === -1)) {
                shouldAllowDeletion = true
                logDebug(`Allowing product deletion during split operation: ${row.IdProducto} on bill ${row.Folio}`)
              }
              
              break
            }
          }
        }
        
        // Determine if we should skip this record
        let skipProcessing = false;
        let skipReason = '';
        
        // Only apply standard deduplication if this isn't a deletion as part of a split operation
        if (!shouldAllowDeletion) {
          if (cache.has(eventKey)) {
            skipProcessing = true;
            skipReason = 'Skipped - duplicate event (cache hit)';
          } else if (processedProductsInBatch.has(productMovementKey)) {
            skipProcessing = true;
            skipReason = 'Skipped - duplicate event (batch hit)';
          }
        } else {
          // For deletions in split operations, we use a different approach for deduplication
          // We'll still process the first instance of a deletion, but skip any subsequent ones
          // with the same characteristics
          const splitProductKey = `split-delete-${row.Folio}-${row.IdProducto}-${row.Movimiento}`;
          
          if (processedProductsInBatch.has(splitProductKey)) {
            skipProcessing = true;
            skipReason = 'Skipped - duplicate split deletion';
          } else {
            processedProductsInBatch.add(splitProductKey);
          }
        }
        
        // Skip processing if needed
        if (skipProcessing) {
          logDebug(`${skipReason}: ${eventKey}`);
          
          // Still mark it as processed in the database
          const now = new Date().toISOString();
          await pool.request()
            .input('response', sql.NVarChar, skipReason)
            .input('updateDate', sql.DateTimeOffset, now)
            .input('id', sql.Int, row.ID)
            .query(`
              UPDATE ProductEvents 
              SET IsSuccess = 1, 
                  IsFailed = 0, 
                  Response = @response, 
                  UpdateDate = @updateDate 
              WHERE ID = @id
            `);
          continue;
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
        
        // Add split-related fields
        if (row.IsSplitTable !== null) message.isSplitTable = row.IsSplitTable
        if (row.MainTable !== null) message.mainTable = row.MainTable
        if (row.SplitSuffix !== null) message.splitSuffix = row.SplitSuffix
        
        // Add split operation tracking
        if (isSplitOperation) {
          message.isSplitOperation = true
          if (splitOperationKey) message._splitOperationKey = splitOperationKey
          if (shouldAllowDeletion) message.isSplitDeletion = true
        }

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

        // Add to deduplication mechanisms
        cache.add(eventKey)
        processedProductsInBatch.add(productMovementKey)
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
/**
 * Process changes in the PaymentEvents table
 */
async function processPaymentChanges() {
  const tableName = 'PaymentEvents'
  try {
    // Use a transaction with serializable isolation to prevent race conditions
    const transaction = new sql.Transaction(pool)
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    
    try {
      // Get changes since last version, but ONLY those that are not already being processed
      const result = await transaction.request()
        .input('lastVersion', sql.BigInt, lastChangeVersions[tableName])
        .query(`
          SELECT p.*, CT.SYS_CHANGE_OPERATION, CT.SYS_CHANGE_VERSION
          FROM CHANGETABLE(CHANGES ${tableName}, @lastVersion) AS CT
          JOIN ${tableName} p ON p.ID = CT.ID
          WHERE CT.SYS_CHANGE_OPERATION IN ('I', 'U')
            AND p.UpdateDate IS NULL
            AND p.Response IS NULL -- Ensure we only get records that no other process is handling
          ORDER BY CT.SYS_CHANGE_VERSION
        `)

      if (result.recordset.length === 0) {
        await transaction.commit()
        return false
      }

      logInfo(`Found ${result.recordset.length} payment changes to process`)

      let newVersion = lastChangeVersions[tableName]
      let processedCount = 0
      const cache = processedEventsCache[tableName]

      // Immediately mark all retrieved records as "being processed" within the transaction
      // This prevents other parallel runs from picking up the same records
      for (const row of result.recordset) {
        const now = new Date().toISOString()
        await transaction.request()
          .input('response', sql.NVarChar, 'Processing in progress')
          .input('updateDate', sql.DateTimeOffset, now)
          .input('id', sql.Int, row.ID)
          .query(`
            UPDATE PaymentEvents 
            SET IsSuccess = 0, 
                IsFailed = 0, 
                Response = @response, 
                UpdateDate = @updateDate 
            WHERE ID = @id AND (UpdateDate IS NULL OR Response IS NULL)
          `)
      }
      
      // Commit transaction to release locks but keep the "processing" state
      await transaction.commit()

      // Process the payments outside the transaction
      const uniquePaymentIds = new Set()
      
      for (const row of result.recordset) {
        try {
          // Update highest change version seen
          if (row.SYS_CHANGE_VERSION > newVersion) {
            newVersion = row.SYS_CHANGE_VERSION
          }

          // Enhanced deduplication - create multiple keys for robust checking
          const eventKey = `${row.ID}-${row.Status}-${row.Folio}-${row.IdFormaDePago}`
          
          // Create a stronger uniqueness key using WorkspaceId (uniqueCodeFromPos) and UniqueBillCodePos
          // These should be unique per payment across the system
          const strongUniqueKey = `${row.WorkspaceId || ''}-${row.UniqueBillCodePos || ''}`
          
          // Skip if we've already processed this exact event recently
          // Either via eventKey in the cache or strongUniqueKey in this batch
          if (cache.has(eventKey) || uniquePaymentIds.has(strongUniqueKey)) {
            logDebug(`Skipping already processed payment event: ${eventKey || strongUniqueKey}`)

            // Update with "skipped" status
            const now = new Date().toISOString();
            await pool.request()
              .input('response', sql.NVarChar, 'Skipped - duplicate event')
              .input('updateDate', sql.DateTimeOffset, now)
              .input('id', sql.Int, row.ID)
              .query(`
                UPDATE PaymentEvents 
                SET IsSuccess = 1, 
                    IsFailed = 0, 
                    Response = @response, 
                    UpdateDate = @updateDate 
                WHERE ID = @id
              `);
            
            // Add to cache to prevent duplicate processing
            cache.add(eventKey);
            processedCount++;
            
            continue; // Skip to next payment
          }

          // Add to our batch deduplication set before processing
          if (strongUniqueKey.length > 2) { // Ensure it's not just "-"
            uniquePaymentIds.add(strongUniqueKey)
          }

          // Check if referencia contains AvoqadoTpv
          const shouldSkipSending = row.Referencia && row.Referencia.includes('AvoqadoTpv');
          
          if (shouldSkipSending) {
            // For AvoqadoTpv payments, skip sending to backend but mark as successfully processed
            logDebug(`Skipping sending AvoqadoTpv payment event ${row.ID} to backend`);
            
            // Update as successfully processed without publishing
            const now = new Date().toISOString();
            await pool.request()
              .input('response', sql.NVarChar, 'Success - AvoqadoTpv payment (not sent to backend)')
              .input('updateDate', sql.DateTimeOffset, now)
              .input('id', sql.Int, row.ID)
              .query(`
                UPDATE PaymentEvents 
                SET IsSuccess = 1, 
                    IsFailed = 0, 
                    Response = @response, 
                    UpdateDate = @updateDate 
                WHERE ID = @id
              `);
            
            // Add to cache to prevent duplicate processing
            cache.add(eventKey);
            processedCount++;
            
            continue; // Skip to next payment
          }

          // Build message object
          const message = {
            venueId,
            folio: row.Folio,
            idFormaDePago: row.IdFormaDePago,
            table: row.TableNumber,
            operation: row.OperationType,
            status: row.Status,
            source: row.Source
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
          if (row.TpvId !== null) message.tpvId = row.TpvId

          if (row.SplitSuffix !== null) message.split_suffix = row.SplitSuffix

          // Publish to RabbitMQ
          const publishResult = await publishEvent('PaymentEvents', message)

          // Update with final result
          const finalResponse = publishResult ? 'Published to RabbitMQ' : 'Failed to publish to RabbitMQ'
          await pool.request()
            .input('response', sql.NVarChar, finalResponse)
            .input('updateDate', sql.DateTimeOffset, new Date().toISOString())
            .input('id', sql.Int, row.ID)
            .query(`
              UPDATE PaymentEvents 
              SET IsSuccess = ${publishResult ? 1 : 0}, 
                  IsFailed = ${publishResult ? 0 : 1}, 
                  Response = @response 
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
            await pool.request()
              .input('response', sql.NVarChar, `Error: ${error.message}`)
              .input('updateDate', sql.DateTimeOffset, now)
              .input('id', sql.Int, row.ID)
              .query(`
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
      // If any error occurs during transaction, roll it back
      await transaction.rollback()
      throw error
    }
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