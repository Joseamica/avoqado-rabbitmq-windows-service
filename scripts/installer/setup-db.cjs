// CommonJS version of setup-db.js
try {
  // First ensure dependencies are installed
  require('./ensure-dependencies')
} catch (error) {
  console.error('Failed to ensure dependencies:', error.message)
  // Continue execution - we'll handle missing modules during import
}

// Now try to load required modules with error handling
let fs, path, sql, dotenv

try {
  fs = require('fs')
} catch (error) {
  console.error('Failed to load fs module:', error.message)
  process.exit(1)
}

try {
  path = require('path')
} catch (error) {
  console.error('Failed to load path module:', error.message)
  process.exit(1)
}

try {
  dotenv = require('dotenv')
} catch (error) {
  console.error('Failed to load dotenv:', error.message)
  console.error('Trying to continue without dotenv...')
}

// Only load SQL after ensuring dependencies
try {
  sql = require('mssql')
} catch (error) {
  console.error('Failed to load mssql module:', error.message)
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('This could be due to missing dependencies. Please run:')
    console.error('npm install debug ms mssql dotenv tedious')
  }
  process.exit(1)
}

// Get fsPromises after ensuring fs is loaded
const fsPromises = fs.promises

// Load environment variables
if (dotenv) {
  dotenv.config()
}

// Get paths based on environment
let rootPath, sqlScriptPath, configPath

// Check if we're running from the packaged app
if (process.env.APP_IS_PACKAGED === 'true') {
  // In production, use environment variables set by main.cjs
  rootPath = process.env.APP_DATA_PATH || path.join(__dirname, '..', '..')
  configPath = process.env.CONFIG_FILE_PATH || path.join(rootPath, '.env')

  // Look for SQL scripts in various locations
  const possibleSqlPaths = [
    // First look in app.asar.unpacked
    path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'app.asar.unpacked', 'scripts', 'sql'),
    // Then look in resources directory
    path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'scripts', 'sql'),
    // Fallback to extraResources
    path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'scripts', 'sql')
  ]

  // Find the first path that exists
  sqlScriptPath = possibleSqlPaths.find((p) => fs.existsSync(p))

  if (!sqlScriptPath) {
    console.error('Could not find SQL scripts directory in any of the expected locations')
    // Create a default path
    sqlScriptPath = path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'scripts', 'sql')

    // Create the directory if it doesn't exist
    if (!fs.existsSync(sqlScriptPath)) {
      fs.mkdirSync(sqlScriptPath, { recursive: true })
    }
  }

  console.log('Running in production mode')
} else {
  // In development
  rootPath = path.join(__dirname, '..', '..')
  configPath = path.join(rootPath, '.env')
  sqlScriptPath = path.join(rootPath, 'scripts', 'sql')

  console.log('Running in development mode')
}

console.log(`Root path: ${rootPath}`)
console.log(`Config path: ${configPath}`)
console.log(`SQL script path: ${sqlScriptPath}`)

// Load .env file if it exists
if (fs.existsSync(configPath) && dotenv) {
  dotenv.config({ path: configPath })
  console.log('Loaded configuration from:', configPath)
} else {
  console.warn('No configuration file found at:', configPath)
}

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
      trustServerCertificate: true,
      connectTimeout: 30000, // Increased timeout
      requestTimeout: 30000 // Increased request timeout
    }
  }

  // Add instance name if provided
  if (process.env.DB_INSTANCE) {
    config.options.instanceName = process.env.DB_INSTANCE
  }

  return config
}

// SQL script filenames and their dependencies
const sqlFiles = [
  {
    filename: 'setup-change-tracking.sql',
    description: 'Setting up change tracking'
  },
  {
    filename: 'create-ticketevents.sql',
    description: 'Creating TicketEvents table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[TicketEvents](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [Folio] [nvarchar](100) NOT NULL,
        [TableNumber] [nvarchar](100) NOT NULL,
        [OrderNumber] [int] NULL,
        [EventType] [nvarchar](20) NOT NULL,
        [OperationType] [nvarchar](20) NOT NULL,
        [ShiftId] [int] NULL,
        [ShiftState] [nvarchar](20) NULL,
        [IsSplitOperation] [bit] NOT NULL,
        [SplitRole] [nvarchar](20) NULL,
        [OriginalTable] [nvarchar](100) NULL,
        [SplitTables] [nvarchar](500) NULL,
        [SplitFolios] [nvarchar](500) NULL,
        [ParentFolio] [nvarchar](100) NULL,
        [WaiterId] [nvarchar](50) NULL,
        [WaiterName] [nvarchar](100) NULL,
        [Total] [money] NULL,
        [Descuento] [money] NULL,
        [UniqueCode] [nvarchar](100) NULL,
        [SourceEvent] [nvarchar](500) NULL,
        [SourceEventId] [int] NULL,
        [IsProcessed] [bit] NOT NULL,
        [ProcessedDate] [datetime] NULL,
        [Response] [nvarchar](max) NULL,
        [CreateDate] [datetime] NOT NULL,
        [UpdateDate] [datetime] NULL,
      PRIMARY KEY CLUSTERED 
      (
        [ID] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT ((0)) FOR [IsSplitOperation]
      GO
      ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT ((0)) FOR [IsProcessed]
      GO
      ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
      GO
    `
  },
  {
    filename: 'create-productevents.sql',
    description: 'Creating ProductEvents table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[ProductEvents](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [Folio] [nvarchar](100) NULL,
        [TableNumber] [nvarchar](100) NULL,
        [OrderNumber] [int] NULL,
        [Status] [nvarchar](50) NULL,
        [WaiterId] [nvarchar](50) NULL,
        [WaiterName] [nvarchar](100) NULL,
        [IsSplitTable] [bit] NULL,
        [MainTable] [nvarchar](100) NULL,
        [SplitSuffix] [nvarchar](10) NULL,
        [IdProducto] [nvarchar](100) NULL,
        [NombreProducto] [nvarchar](200) NULL,
        [Movimiento] [nvarchar](100) NULL,
        [Cantidad] [decimal](18, 4) NULL,
        [Precio] [decimal](18, 2) NULL,
        [Descuento] [decimal](18, 2) NULL,
        [Hora] [nvarchar](100) NULL,
        [Modificador] [nvarchar](max) NULL,
        [Clasificacion] [nvarchar](50) NULL,
        [OperationType] [nvarchar](20) NULL,
        [IsSuccess] [bit] NULL,
        [IsFailed] [bit] NULL,
        [Response] [nvarchar](max) NULL,
        [CreateDate] [datetime] NULL,
        [UpdateDate] [datetime] NULL,
        [ShiftId] [int] NULL,
        [UniqueCode] [nvarchar](100) NULL,
        [uniqueBillCodeFromPos] [nvarchar](100) NULL,
      PRIMARY KEY CLUSTERED 
      (
        [ID] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[ProductEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
      GO
    `
  },
  {
    filename: 'create-paymentevents.sql',
    description: 'Creating PaymentEvents table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[PaymentEvents](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [Folio] [nvarchar](100) NULL,
        [IdFormaDePago] [nvarchar](100) NULL,
        [Importe] [decimal](18, 2) NULL,
        [Propina] [decimal](18, 2) NULL,
        [Referencia] [nvarchar](100) NULL,
        [WorkspaceId] [nvarchar](100) NULL,
        [TableNumber] [nvarchar](100) NULL,
        [OrderNumber] [int] NULL,
        [IsSplitTable] [bit] NULL,
        [MainTable] [nvarchar](100) NULL,
        [SplitSuffix] [nvarchar](10) NULL,
        [Status] [nvarchar](50) NULL,
        [OperationType] [nvarchar](20) NULL,
        [IsSuccess] [bit] NULL,
        [IsFailed] [bit] NULL,
        [Response] [nvarchar](max) NULL,
        [CreateDate] [datetime] NULL,
        [UpdateDate] [datetime] NULL,
        [UniqueBillCodePos] [nvarchar](100) NULL,
        [Method] [int] NULL,
      PRIMARY KEY CLUSTERED 
      (
        [ID] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[PaymentEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
      GO
    `
  },
  {
    filename: 'create-turnoevents.sql',
    description: 'Creating TurnoEvents table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[TurnoEvents](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [IdTurnoInterno] [int] NULL,
        [IdTurno] [int] NULL,
        [Fondo] [decimal](18, 2) NULL,
        [Apertura] [datetime] NULL,
        [Cierre] [datetime] NULL,
        [Cajero] [nvarchar](100) NULL,
        [Efectivo] [decimal](18, 2) NULL,
        [Tarjeta] [decimal](18, 2) NULL,
        [Vales] [decimal](18, 2) NULL,
        [Credito] [decimal](18, 2) NULL,
        [CorteEnviado] [bit] NULL,
        [Status] [nvarchar](50) NULL,
        [OperationType] [nvarchar](20) NULL,
        [IsSuccess] [bit] NULL,
        [IsFailed] [bit] NULL,
        [Response] [nvarchar](max) NULL,
        [CreateDate] [datetime] NULL,
        [UpdateDate] [datetime] NULL,
      PRIMARY KEY CLUSTERED 
      (
        [ID] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[TurnoEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
      GO
    `
  },
  {
    filename: 'create-shiftclosurestate.sql',
    description: 'Creating ShiftClosureState table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[ShiftClosureState](
        [Id] [int] IDENTITY(1,1) NOT NULL,
        [ShiftId] [int] NOT NULL,
        [StartTime] [datetime] NOT NULL,
        [EndTime] [datetime] NULL,
        [Status] [varchar](20) NOT NULL,
        [CreatedBy] [nvarchar](100) NULL,
      PRIMARY KEY CLUSTERED 
      (
        [Id] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[ShiftClosureState] ADD  DEFAULT (getdate()) FOR [StartTime]
      GO
      ALTER TABLE [dbo].[ShiftClosureState] ADD  DEFAULT ('ACTIVE') FOR [Status]
      GO
    `
  },
  {
    filename: 'create-shiftlog.sql',
    description: 'Creating ShiftLog table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      CREATE TABLE [dbo].[ShiftLog](
        [Id] [int] IDENTITY(1,1) NOT NULL,
        [EventTime] [datetime] NOT NULL,
        [EventType] [varchar](50) NOT NULL,
        [ShiftId] [int] NULL,
        [Details] [nvarchar](max) NULL,
        [FolioInfo] [nvarchar](100) NULL,
      PRIMARY KEY CLUSTERED 
      (
        [Id] ASC
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
      GO
      ALTER TABLE [dbo].[ShiftLog] ADD  DEFAULT (getdate()) FOR [EventTime]
      GO
    `
  },
  // Triggers - these should be executed after tables are created
  {
    filename: 'trigger-chequeactualizado.sql',
    description: 'Creating trgChequeActualizado trigger',
    depends: ['create-ticketevents.sql']
  },
  {
    filename: 'trigger-comandaactualizado.sql',
    description: 'Creating trgComandaActualizado trigger',
    depends: ['create-productevents.sql']
  },
  {
    filename: 'trigger-pagoactualizado.sql',
    description: 'Creating trgChequePagoActualizado trigger',
    depends: ['create-paymentevents.sql']
  },
  {
    filename: 'trigger-turnoactualizado.sql',
    description: 'Creating trgTurnosActualizado trigger',
    depends: ['create-turnoevents.sql']
  },
  {
    filename: 'trigger-turnoclosuredetect.sql',
    description: 'Creating trgTurnosShiftClosureDetect trigger',
    depends: ['create-shiftclosurestate.sql', 'create-shiftlog.sql']
  },
  {
    filename: 'trigger-turnoclosing.sql',
    description: 'Creating trgTurnosShiftClosing trigger',
    depends: ['create-shiftlog.sql']
  },
  {
    filename: 'trigger-turnoclosurecomplete.sql',
    description: 'Creating trgTurnosShiftClosureComplete trigger',
    depends: ['create-shiftclosurestate.sql', 'create-shiftlog.sql']
  }
]

// Function to check if a table exists
async function tableExists(pool, tableName) {
  try {
    const result = await pool.request().query(`
      SELECT COUNT(*) AS tableCount 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = '${tableName}'
    `)
    return result.recordset[0].tableCount > 0
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error.message)
    return false
  }
}

// Function to check if a trigger exists
async function triggerExists(pool, triggerName) {
  try {
    const result = await pool.request().query(`
      SELECT COUNT(*) AS triggerCount 
      FROM sys.triggers 
      WHERE name = '${triggerName}'
    `)
    return result.recordset[0].triggerCount > 0
  } catch (error) {
    console.error(`Error checking if trigger ${triggerName} exists:`, error.message)
    return false
  }
}

// Function to check if a default constraint exists on a column
async function defaultConstraintExists(pool, tableName, columnName) {
  try {
    const result = await pool.request().query(`
      SELECT COUNT(*) AS constraintCount
      FROM sys.default_constraints dc
      JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
      JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = '${tableName}'
      AND c.name = '${columnName}'
    `)
    return result.recordset[0].constraintCount > 0
  } catch (error) {
    console.error(`Error checking if default constraint exists for ${tableName}.${columnName}:`, error.message)
    return false
  }
}

// Extract the object name from a CREATE/ALTER statement
function extractObjectName(sqlBatch) {
  // Check for tables
  const tableMatch = sqlBatch.match(/CREATE\s+TABLE\s+\[?dbo\]?\.\[?(\w+)\]?/i)
  if (tableMatch) return { type: 'TABLE', name: tableMatch[1] }

  // Check for triggers
  const triggerMatch = sqlBatch.match(/CREATE\s+TRIGGER\s+\[?dbo\]?\.\[?(\w+)\]?/i)
  if (triggerMatch) return { type: 'TRIGGER', name: triggerMatch[1] }

  // Check for default constraints
  const defaultMatch = sqlBatch.match(/ALTER\s+TABLE\s+\[?dbo\]?\.\[?(\w+)\]?\s+ADD\s+DEFAULT\s+.*\s+FOR\s+\[?(\w+)\]?/i)
  if (defaultMatch) return { type: 'DEFAULT_CONSTRAINT', table: defaultMatch[1], column: defaultMatch[2] }

  return { type: 'OTHER', name: null }
}

// Function to execute batches of SQL separated by GO with existence checking
async function executeSqlBatches(pool, sqlContent) {
  const batches = sqlContent.split(/\nGO\s*$/m)
  let batchNumber = 0

  for (const batch of batches) {
    const trimmedBatch = batch.trim()
    batchNumber++

    if (!trimmedBatch) continue

    // Check if this batch is a CREATE statement for a table or trigger or an ALTER adding a default
    const objectInfo = extractObjectName(trimmedBatch)

    let skipBatch = false

    if (objectInfo.type === 'TABLE' && objectInfo.name) {
      const exists = await tableExists(pool, objectInfo.name)
      if (exists) {
        console.log(`  Table [${objectInfo.name}] already exists, skipping creation`)
        skipBatch = true
      }
    } else if (objectInfo.type === 'TRIGGER' && objectInfo.name) {
      const exists = await triggerExists(pool, objectInfo.name)
      if (exists) {
        console.log(`  Trigger [${objectInfo.name}] already exists, skipping creation`)
        skipBatch = true
      }
    } else if (objectInfo.type === 'DEFAULT_CONSTRAINT' && objectInfo.table && objectInfo.column) {
      const exists = await defaultConstraintExists(pool, objectInfo.table, objectInfo.column)
      if (exists) {
        console.log(`  Default constraint for [${objectInfo.table}].[${objectInfo.column}] already exists, skipping`)
        skipBatch = true
      }
    }

    if (skipBatch) continue

    // Execute the batch if we didn't decide to skip it
    try {
      await pool.request().batch(trimmedBatch)
      console.log(`  Batch ${batchNumber}/${batches.length} executed successfully`)
    } catch (error) {
      console.error(`  Error executing batch ${batchNumber}:`, error.message)
      // Log problematic batch during development (only first 100 chars to keep logs clean)
      console.log(`  Problematic batch: ${trimmedBatch.substring(0, 100)}...`)
      // Don't stop on errors - continue with next batch
      console.log('  Continuing with next batch...')
    }
  }
}

// Main function
async function main() {
  let pool = null

  try {
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║           Avoqado POS Database Setup Utility             ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('This utility will set up your database for use with Avoqado POS services.\n')

    // Ensure the SQL directory exists
    try {
      await fsPromises.mkdir(sqlScriptPath, { recursive: true })
    } catch (mkdirError) {
      console.warn(`Could not create SQL directory: ${mkdirError.message}`)
      // Continue anyway
    }

    // Get connection config
    const dbConfig = createDbConfig()
    console.log(
      'Connecting to database with config:',
      JSON.stringify(
        {
          user: dbConfig.user,
          server: dbConfig.server,
          database: dbConfig.database,
          options: dbConfig.options
        },
        null,
        2
      )
    )

    // Connect to database
    console.log('Connecting to database...')
    pool = await sql.connect(dbConfig)
    console.log('Connected to database successfully!\n')

    // Process each SQL file/section
    for (const sqlFile of sqlFiles) {
      console.log(`Processing: ${sqlFile.description}...`)

      // Define the path for the current SQL file
      const filePath = path.join(sqlScriptPath, sqlFile.filename)
      let sqlContent = ''

      // Try to read the file, if it exists
      try {
        sqlContent = await fsPromises.readFile(filePath, 'utf8')
        console.log(`  Loaded SQL from file: ${sqlFile.filename}`)
      } catch (error) {
        // File doesn't exist, use fallback SQL if provided
        if (sqlFile.fallbackSQL) {
          console.log(`  File ${sqlFile.filename} not found, using embedded SQL definition`)
          sqlContent = sqlFile.fallbackSQL

          // Save the fallback SQL to the file for future use
          try {
            await fsPromises.writeFile(filePath, sqlContent)
            console.log(`  Created file: ${sqlFile.filename} with embedded SQL definition`)
          } catch (writeError) {
            console.error(`  Warning: Could not create file ${sqlFile.filename}:`, writeError.message)
          }
        } else {
          console.error(`  Warning: SQL file ${sqlFile.filename} not found and no fallback provided. Skipping.`)
          continue
        }
      }

      // Execute the SQL content
      await executeSqlBatches(pool, sqlContent)
      console.log(`  Completed: ${sqlFile.description}\n`)
    }

    // Get current change tracking version
    console.log('Getting current change tracking version...')
    const versionResult = await pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() AS CurrentVersion')
    const currentVersion = versionResult.recordset[0].CurrentVersion
    console.log(`Current change tracking version: ${currentVersion}`)

    // Verify tables were created
    try {
      console.log('\nVerifying table creation...')
      const verifyResult = await pool.request().query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_NAME IN ('TicketEvents', 'ProductEvents', 'PaymentEvents', 'TurnoEvents')
      `)

      console.log(`${verifyResult.recordset.length} of 4 required tables exist:`)
      verifyResult.recordset.forEach((row) => {
        console.log(`- ${row.TABLE_NAME}`)
      })
    } catch (verifyError) {
      console.error('Error verifying tables:', verifyError.message)
    }

    // Close the pool
    await pool.close()

    console.log('\n✅ Database setup completed successfully')
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║                     Next Steps                           ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('Install and start the Windows service:')
    console.log('   npm run install-service')

    // Force process exit after a short delay to ensure all logs are written
    setTimeout(() => {
      process.exit(0) // This is critical - explicitly exit the process
    }, 1500)
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
