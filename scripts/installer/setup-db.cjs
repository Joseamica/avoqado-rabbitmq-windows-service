// CommonJS version of setup-db.js
const fs = require('fs') // Regular fs for sync methods
const fsPromises = require('fs').promises // Promise-based fs
const path = require('path')
const sql = require('mssql')
const dotenv = require('dotenv')
const inquirer = require('inquirer')

// Load environment variables
dotenv.config()

// In CommonJS, __dirname is already defined, so we don't need to declare it
// Get paths
const rootPath = path.join(__dirname, '..', '..')
const sqlScriptPath = path.join(__dirname, '..', 'sql', 'setup-change-tracking.sql')

// Create database connection configuration
function createDbConfig() {
  // If a full connection string is provided, use it
  if (process.env.DB_CONNECTION_STRING) {
    return {
      connectionString: process.env.DB_CONNECTION_STRING
    }
  }

  // Otherwise, build from individual parts
  const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'avo',
    server: process.env.DB_SERVER || 'localhost',
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  }

  // Add instance name if provided
  if (process.env.DB_INSTANCE) {
    config.options.instanceName = process.env.DB_INSTANCE
  }

  return config
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           Avoqado POS Database Setup Utility             ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('This utility will enable Change Tracking on your database.\n')

  try {
    // Ensure the SQL directory exists
    await fsPromises.mkdir(path.join(__dirname, '..', 'sql'), { recursive: true })

    // Create SQL script if it doesn't exist
    const sqlScript = `-- Enable Change Tracking on the database
IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id = DB_ID())
BEGIN
    ALTER DATABASE CURRENT
    SET CHANGE_TRACKING = ON
    (CHANGE_RETENTION = 2 DAYS, AUTO_CLEANUP = ON);
    
    PRINT 'Change Tracking enabled on database successfully';
END
ELSE
BEGIN
    PRINT 'Change Tracking is already enabled on database';
END
GO

-- Check if tables exist and enable change tracking on each

-- TicketEvents table
IF OBJECT_ID('dbo.TicketEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.TicketEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.TicketEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on TicketEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on TicketEvents table';
    END
END
ELSE
BEGIN
    PRINT 'TicketEvents table does not exist';
END
GO

-- ProductEvents table
IF OBJECT_ID('dbo.ProductEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.ProductEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.ProductEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on ProductEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on ProductEvents table';
    END
END
ELSE
BEGIN
    PRINT 'ProductEvents table does not exist';
END
GO

-- PaymentEvents table
IF OBJECT_ID('dbo.PaymentEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.PaymentEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.PaymentEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on PaymentEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on PaymentEvents table';
    END
END
ELSE
BEGIN
    PRINT 'PaymentEvents table does not exist';
END
GO

-- TurnoEvents table
IF OBJECT_ID('dbo.TurnoEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.TurnoEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.TurnoEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on TurnoEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on TurnoEvents table';
    END
END
ELSE
BEGIN
    PRINT 'TurnoEvents table does not exist';
END
GO

-- Get current change tracking version for reference
SELECT CHANGE_TRACKING_CURRENT_VERSION() AS CurrentChangeTrackingVersion;
GO`

    await fsPromises.writeFile(sqlScriptPath, sqlScript)

    console.log('Ready to enable Change Tracking on your database...')

    console.log('Connecting to database...')
    const pool = await sql.connect(createDbConfig())

    console.log('Running Change Tracking setup script...')

    // Read SQL script and split by GO statements
    const scriptContent = await fsPromises.readFile(sqlScriptPath, 'utf8')
    const batches = scriptContent.split(/\nGO\s*$/m)

    // Execute each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i].trim()
      if (batch) {
        try {
          const result = await pool.request().batch(batch)
          console.log(`Batch ${i + 1}/${batches.length} executed successfully`)
        } catch (error) {
          console.error(`Error executing batch ${i + 1}:`, error.message)
          console.log('Continuing with next batch...')
        }
      }
    }

    console.log('Getting current change tracking version...')
    const versionResult = await pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() AS CurrentVersion')

    const currentVersion = versionResult.recordset[0].CurrentVersion
    console.log(`\nCurrent change tracking version: ${currentVersion}`)

    console.log('\n✅ Database setup completed successfully')

    // Close the pool
    await pool.close()

    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║                     Next Steps                           ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('Install and start the Windows service:')
    console.log('   npm run install-service')
  } catch (error) {
    console.error(`\n❌ Error during database setup: ${error.message}`)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('An unexpected error occurred:', error)
  process.exit(1)
})
