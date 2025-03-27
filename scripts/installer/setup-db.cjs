// Improved setup-db.cjs with better error handling and config finding
const fs = require('fs')
const path = require('path')
const { execSync, spawn } = require('child_process')
const os = require('os')

console.log('Starting database setup with diagnostic mode...')

// Load dotenv if available
let dotenv
try {
  dotenv = require('dotenv')
  dotenv.config()
  console.log('Loaded environment variables from .env file')
} catch (err) {
  console.warn('dotenv not available, continuing without .env file support')
}

// Get paths based on environment
const isPackaged = process.resourcesPath && process.resourcesPath.includes('app.asar')
let rootPath, sqlScriptPath, configPath

// Check if we're running from the packaged app
if (isPackaged) {
  // In production, use environment variables passed from main.cjs with fallbacks
  const appDataPath = process.env.APP_DATA_PATH || path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service')
  rootPath = appDataPath
  configPath = process.env.CONFIG_FILE_PATH || path.join(appDataPath, '.env')

  // Look for SQL scripts in various locations
  const possibleSqlPaths = [
    // Try the SQL_SCRIPTS_PATH environment variable first
    process.env.SQL_SCRIPTS_PATH,
    // Then in resources directory
    path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'scripts', 'sql'),
    // Then in app.asar.unpacked
    path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'app.asar.unpacked', 'scripts', 'sql'),
    // Fallback to a standard location
    path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service', 'scripts', 'sql')
  ].filter(Boolean) // Filter out undefined entries

  // Find the first path that exists
  sqlScriptPath = possibleSqlPaths.find((p) => {
    try {
      return fs.existsSync(p)
    } catch (err) {
      return false
    }
  })

  if (!sqlScriptPath) {
    console.error('Could not find SQL scripts directory in any of the expected locations:')
    possibleSqlPaths.forEach((p) => console.log(`- ${p}`))

    // Create a default path
    sqlScriptPath = path.join(process.env.RESOURCES_PATH || process.resourcesPath, 'scripts', 'sql')
    console.log(`Will use default path: ${sqlScriptPath}`)

    // Create the directory if it doesn't exist
    if (!fs.existsSync(sqlScriptPath)) {
      try {
        fs.mkdirSync(sqlScriptPath, { recursive: true })
        console.log(`Created SQL scripts directory at ${sqlScriptPath}`)
      } catch (err) {
        console.warn(`Could not create SQL directory: ${err.message}`)
      }
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

// Function to find the configuration file in multiple possible locations
function findConfigFile() {
  const possiblePaths = [
    configPath, // Primary path (from environment)
    process.env.CONFIG_FILE_PATH, // Direct environment variable
    process.env.APP_DATA_CONFIG_PATH, // AppData config path from main.cjs
    path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service', '.env'), // AppData path
    path.join(process.resourcesPath || '', '.env'), // Application resources
    path.join(rootPath, '.env'), // Root path
    path.join(__dirname, '..', '..', '.env') // Development path
  ].filter(Boolean) // Remove undefined entries

  console.log('Searching for configuration file in these locations:')
  possiblePaths.forEach((p) => console.log(`- ${p}`))

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`✅ Found configuration file at: ${p}`)
        return p
      }
    } catch (err) {
      // Ignore errors and continue searching
    }
  }

  console.error('❌ Configuration file not found in any location')
  return null
}

// Use this function to find the actual config path
const actualConfigPath = findConfigFile()
if (actualConfigPath) {
  configPath = actualConfigPath // Update the config path to the one found

  // Now load the config using dotenv
  if (dotenv) {
    try {
      dotenv.config({ path: configPath })
      console.log(`Loaded configuration from: ${configPath}`)
    } catch (err) {
      console.warn(`Error loading config: ${err.message}`)
    }
  }
} else {
  console.error('No configuration file found. Please run the setup step first.')
}

// Create database connection configuration
function createDbConfig() {
  // If a full connection string is provided, parse it
  if (process.env.DB_CONNECTION_STRING) {
    // Simple parser for connection string
    const connStr = process.env.DB_CONNECTION_STRING
    const config = {}

    // Simple parsing of connection string parts
    connStr.split(';').forEach((pair) => {
      const [key, value] = pair.split('=')
      if (key && value) {
        const k = key.trim().toLowerCase()
        if (k === 'server') config.server = value.trim()
        else if (k === 'user id' || k === 'uid') config.user = value.trim()
        else if (k === 'password' || k === 'pwd') config.password = value.trim()
        else if (k === 'database' || k === 'initial catalog') config.database = value.trim()
        else if (k === 'instance name') config.instanceName = value.trim()
      }
    })

    return config
  }

  // Check if server has format "server\instance"
  let server = process.env.DB_SERVER || 'localhost'
  let instanceName = process.env.DB_INSTANCE || undefined

  if (server.includes('\\')) {
    const parts = server.split('\\')
    server = parts[0]
    instanceName = parts[1]
    console.log(`Detected server with instance: ${server}\\${instanceName}`)
  }

  // Otherwise, build from individual parts
  return {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '', // Use empty string instead of undefined
    database: process.env.DB_DATABASE || 'avo',
    server: server,
    instanceName: instanceName,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 30000
    }
  }
}

// SQL script filenames and their dependencies (existing definition)
const sqlFiles = [
  {
    filename: 'setup-change-tracking.sql',
    description: 'Setting up change tracking',
    fallbackSQL: `
      IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id = DB_ID())
      BEGIN
          ALTER DATABASE [${process.env.DB_DATABASE || 'avo'}] SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON)
      END
      GO
    `
  },
  {
    filename: 'create-ticketevents.sql',
    description: 'Creating TicketEvents table',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TicketEvents]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_TicketEvents_IsSplitOperation]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[TicketEvents] ADD CONSTRAINT [DF_TicketEvents_IsSplitOperation] DEFAULT ((0)) FOR [IsSplitOperation]
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_TicketEvents_IsProcessed]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[TicketEvents] ADD CONSTRAINT [DF_TicketEvents_IsProcessed] DEFAULT ((0)) FOR [IsProcessed]
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_TicketEvents_CreateDate]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[TicketEvents] ADD CONSTRAINT [DF_TicketEvents_CreateDate] DEFAULT (getdate()) FOR [CreateDate]
      END
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
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ProductEvents]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_ProductEvents_CreateDate]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[ProductEvents] ADD CONSTRAINT [DF_ProductEvents_CreateDate] DEFAULT (getdate()) FOR [CreateDate]
      END
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
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PaymentEvents]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_PaymentEvents_CreateDate]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[PaymentEvents] ADD CONSTRAINT [DF_PaymentEvents_CreateDate] DEFAULT (getdate()) FOR [CreateDate]
      END
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
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TurnoEvents]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_TurnoEvents_CreateDate]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[TurnoEvents] ADD CONSTRAINT [DF_TurnoEvents_CreateDate] DEFAULT (getdate()) FOR [CreateDate]
      END
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
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ShiftClosureState]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_ShiftClosureState_StartTime]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[ShiftClosureState] ADD CONSTRAINT [DF_ShiftClosureState_StartTime] DEFAULT (getdate()) FOR [StartTime]
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_ShiftClosureState_Status]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[ShiftClosureState] ADD CONSTRAINT [DF_ShiftClosureState_Status] DEFAULT ('ACTIVE') FOR [Status]
      END
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
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ShiftLog]') AND type in (N'U'))
      BEGIN
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
      END
      GO
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DF_ShiftLog_EventTime]') AND type = 'D')
      BEGIN
      ALTER TABLE [dbo].[ShiftLog] ADD CONSTRAINT [DF_ShiftLog_EventTime] DEFAULT (getdate()) FOR [EventTime]
      END
      GO
    `
  },
  {
    filename: 'trigger-chequeactualizado.sql',
    description: 'Creating trgChequeActualizado trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgChequeActualizado]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgChequeActualizado]
      ON [dbo].[ChequeMaestro]
      AFTER UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Insert into TicketEvents table
          INSERT INTO TicketEvents (
              Folio, TableNumber, OrderNumber, EventType, OperationType,
              ShiftId, IsSplitOperation, WaiterId, WaiterName, Total,
              Descuento, UniqueCode, IsProcessed
          )
          SELECT 
              i.NumeroTicket,
              i.Nombre AS TableNumber,
              i.OrdenNumerica AS OrderNumber,
              ''TICKET'' AS EventType,
              CASE 
                  WHEN i.Activo = 0 AND i.Impreso = 1 THEN ''CLOSE''
                  WHEN i.Activo = 1 THEN ''UPDATE''
                  ELSE ''UNKNOWN''
              END AS OperationType,
              i.IdTurno AS ShiftId,
              0 AS IsSplitOperation,
              i.Usuario AS WaiterId,
              u.Nombre AS WaiterName,
              i.SubTotal AS Total,
              i.Descuento,
              CONCAT(i.NumeroTicket, ''-'', CONVERT(VARCHAR(20), GETDATE(), 112), ''-'', CONVERT(VARCHAR(20), GETDATE(), 108)) AS UniqueCode,
              0 AS IsProcessed
          FROM inserted i
          LEFT JOIN Usuario u ON i.Usuario = u.IdUsuario
          WHERE i.NumeroTicket IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM TicketEvents te 
                  WHERE te.Folio = i.NumeroTicket 
                  AND te.OperationType = CASE 
                      WHEN i.Activo = 0 AND i.Impreso = 1 THEN ''CLOSE''
                      WHEN i.Activo = 1 THEN ''UPDATE''
                      ELSE ''UNKNOWN''
                  END
              );
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-comandaactualizado.sql',
    description: 'Creating trgComandaActualizado trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgComandaActualizado]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgComandaActualizado]
      ON [dbo].[ChequeComanda]
      AFTER INSERT, UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Información de las comandas insertadas o actualizadas
          INSERT INTO ProductEvents (
              Folio, TableNumber, OrderNumber, Status, WaiterId, WaiterName,
              IdProducto, NombreProducto, Movimiento, Cantidad, Precio, Descuento,
              Hora, Modificador, Clasificacion, OperationType, ShiftId, UniqueCode
          )
          SELECT 
              cm.NumeroTicket AS Folio,
              m.Nombre AS TableNumber,
              cm.OrdenNumerica AS OrderNumber,
              cm.Estado AS Status,
              cm.Usuario AS WaiterId,
              u.Nombre AS WaiterName,
              i.IdProducto,
              p.Descripcion AS NombreProducto,
              cm.Movimiento,
              i.Cantidad,
              i.Precio,
              i.Descuento,
              CONVERT(VARCHAR(8), GETDATE(), 108) AS Hora,
              i.Modificador,
              p.Agrupacion AS Clasificacion,
              CASE 
                  WHEN i.Cancelado = 1 THEN ''CANCEL''
                  ELSE ''ADD''
              END AS OperationType,
              cm.IdTurno AS ShiftId,
              CONCAT(cm.NumeroTicket, ''-'', i.IdProducto, ''-'', CONVERT(VARCHAR(20), GETDATE(), 112), ''-'', CONVERT(VARCHAR(20), GETDATE(), 108)) AS UniqueCode
          FROM inserted i
          INNER JOIN ChequeComanda cm ON i.OrderId = cm.OrderID
          LEFT JOIN ChequeMaestro m ON cm.NumeroTicket = m.NumeroTicket
          LEFT JOIN Producto p ON i.IdProducto = p.IdProducto
          LEFT JOIN Usuario u ON cm.Usuario = u.IdUsuario
          WHERE cm.NumeroTicket IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM ProductEvents pe
                  WHERE pe.Folio = cm.NumeroTicket
                  AND pe.IdProducto = i.IdProducto
                  AND pe.Cantidad = i.Cantidad
                  AND pe.Precio = i.Precio
                  AND pe.OperationType = CASE 
                      WHEN i.Cancelado = 1 THEN ''CANCEL''
                      ELSE ''ADD''
                  END
              );
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-pagoactualizado.sql',
    description: 'Creating trgChequePagoActualizado trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgChequePagoActualizado]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgChequePagoActualizado]
      ON [dbo].[ChequePago]
      AFTER INSERT, UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Información de los pagos insertados o actualizados
          INSERT INTO PaymentEvents (
              Folio, IdFormaDePago, Importe, Propina, Referencia,
              TableNumber, OrderNumber, Status, OperationType
          )
          SELECT 
              cm.NumeroTicket AS Folio,
              i.IdFormaDePago,
              i.Importe,
              i.Propina,
              i.Referencia,
              m.Nombre AS TableNumber,
              cm.OrdenNumerica AS OrderNumber,
              cm.Estado AS Status,
              CASE 
                  WHEN i.Activo = 0 THEN ''CANCEL''
                  ELSE ''PAYMENT''
              END AS OperationType
          FROM inserted i
          INNER JOIN ChequeMaestro cm ON i.NumeroTicket = cm.NumeroTicket
          LEFT JOIN Estacion m ON cm.Estacion = m.IdEstacion
          WHERE cm.NumeroTicket IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM PaymentEvents pe
                  WHERE pe.Folio = cm.NumeroTicket
                  AND pe.IdFormaDePago = i.IdFormaDePago
                  AND pe.Importe = i.Importe
                  AND pe.OperationType = CASE 
                      WHEN i.Activo = 0 THEN ''CANCEL''
                      ELSE ''PAYMENT''
                  END
              );
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-turnoactualizado.sql',
    description: 'Creating trgTurnosActualizado trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgTurnosActualizado]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgTurnosActualizado]
      ON [dbo].[Turnos]
      AFTER UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          IF UPDATE(Cerrado)
          BEGIN
              -- Insertamos los turnos cerrados
              INSERT INTO TurnoEvents (
                  IdTurnoInterno, IdTurno, Fondo, Apertura, Cierre,
                  Cajero, Status, OperationType
              )
              SELECT 
                  i.IdTurno AS IdTurnoInterno,
                  i.IdTurnoGlobal AS IdTurno,
                  i.Fondo,
                  i.Apertura,
                  i.Cierre,
                  u.Nombre AS Cajero,
                  CASE 
                      WHEN i.Cerrado = 1 THEN ''CLOSED''
                      ELSE ''OPEN''
                  END AS Status,
                  CASE 
                      WHEN i.Cerrado = 1 AND d.Cerrado = 0 THEN ''CLOSE''
                      ELSE ''UPDATE''
                  END AS OperationType
              FROM inserted i
              INNER JOIN deleted d ON i.IdTurno = d.IdTurno
              LEFT JOIN Usuario u ON i.Usuario = u.IdUsuario
              WHERE i.Cerrado = 1 AND d.Cerrado = 0;
              
              -- Actualizamos los valores de efectivo, tarjeta, vales, etc.
              UPDATE te SET
                  Efectivo = (
                      SELECT SUM(cp.Importe)
                      FROM ChequePago cp
                      WHERE cp.IdTurno = te.IdTurnoInterno
                      AND cp.IdFormaDePago = 1 -- Efectivo
                      AND cp.Activo = 1
                  ),
                  Tarjeta = (
                      SELECT SUM(cp.Importe)
                      FROM ChequePago cp
                      WHERE cp.IdTurno = te.IdTurnoInterno
                      AND cp.IdFormaDePago = 2 -- Tarjeta
                      AND cp.Activo = 1
                  ),
                  Vales = (
                      SELECT SUM(cp.Importe)
                      FROM ChequePago cp
                      WHERE cp.IdTurno = te.IdTurnoInterno
                      AND cp.IdFormaDePago = 3 -- Vales
                      AND cp.Activo = 1
                  ),
                  Credito = (
                      SELECT SUM(cp.Importe)
                      FROM ChequePago cp
                      WHERE cp.IdTurno = te.IdTurnoInterno
                      AND cp.IdFormaDePago = 4 -- Crédito
                      AND cp.Activo = 1
                  ),
                  CorteEnviado = 0,
                  UpdateDate = GETDATE()
              FROM TurnoEvents te
              INNER JOIN inserted i ON te.IdTurnoInterno = i.IdTurno
              WHERE i.Cerrado = 1 AND te.OperationType = ''CLOSE'';
          END
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-turnoclosuredetect.sql',
    description: 'Creating trgTurnosShiftClosureDetect trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgTurnosShiftClosureDetect]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgTurnosShiftClosureDetect]
      ON [dbo].[Turnos]
      AFTER UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Detect when shift closure process starts
          IF UPDATE(Cerrado)
          BEGIN
              -- Insert a new ShiftClosureState record for shifts that are being closed
              INSERT INTO ShiftClosureState (ShiftId, StartTime, Status, CreatedBy)
              SELECT 
                  i.IdTurno,
                  GETDATE(),
                  ''ACTIVE'' AS Status,
                  u.Nombre
              FROM inserted i
              INNER JOIN deleted d ON i.IdTurno = d.IdTurno
              LEFT JOIN Usuario u ON i.Usuario = u.IdUsuario
              WHERE i.Cerrado = 1 AND d.Cerrado = 0
                  AND NOT EXISTS (
                      SELECT 1 FROM ShiftClosureState scs 
                      WHERE scs.ShiftId = i.IdTurno AND scs.Status = ''ACTIVE''
                  );
              
              -- Log shift closure start event
              INSERT INTO ShiftLog (EventType, ShiftId, Details)
              SELECT 
                  ''SHIFT_CLOSURE_STARTED'',
                  i.IdTurno,
                  ''Shift closure process started by '' + ISNULL(u.Nombre, ''Unknown'')
              FROM inserted i
              INNER JOIN deleted d ON i.IdTurno = d.IdTurno
              LEFT JOIN Usuario u ON i.Usuario = u.IdUsuario
              WHERE i.Cerrado = 1 AND d.Cerrado = 0;
          END
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-turnoclosing.sql',
    description: 'Creating trgTurnosShiftClosing trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgTurnosShiftClosing]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgTurnosShiftClosing]
      ON [dbo].[Turnos]
      AFTER UPDATE
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Check if any open tickets remain for the shift being closed
          IF UPDATE(Cerrado)
          BEGIN
              -- Find shifts that are being closed
              DECLARE @ClosingShifts TABLE (ShiftId INT);
              
              INSERT INTO @ClosingShifts
              SELECT i.IdTurno
              FROM inserted i
              INNER JOIN deleted d ON i.IdTurno = d.IdTurno
              WHERE i.Cerrado = 1 AND d.Cerrado = 0;
              
              -- Check for open tickets for each closing shift
              DECLARE @OpenTickets TABLE (ShiftId INT, TicketCount INT);
              
              INSERT INTO @OpenTickets
              SELECT 
                  cs.ShiftId,
                  COUNT(cm.NumeroTicket) AS OpenTicketCount
              FROM @ClosingShifts cs
              CROSS APPLY (
                  SELECT cm.NumeroTicket
                  FROM ChequeMaestro cm
                  WHERE cm.IdTurno = cs.ShiftId
                      AND cm.Activo = 1
              ) AS cm
              GROUP BY cs.ShiftId;
              
              -- Log warning for shifts with open tickets
              INSERT INTO ShiftLog (EventType, ShiftId, Details)
              SELECT 
                  ''SHIFT_CLOSURE_WARNING'',
                  ot.ShiftId,
                  ''Shift is being closed with '' + CAST(ot.TicketCount AS VARCHAR) + '' open tickets''
              FROM @OpenTickets ot
              WHERE ot.TicketCount > 0;
              
              -- Log regular closing for shifts without open tickets
              INSERT INTO ShiftLog (EventType, ShiftId, Details)
              SELECT 
                  ''SHIFT_CLOSING'',
                  cs.ShiftId,
                  ''Shift closure in progress''
              FROM @ClosingShifts cs
              LEFT JOIN @OpenTickets ot ON cs.ShiftId = ot.ShiftId
              WHERE ot.ShiftId IS NULL;
          END
      END
      ' 
      END
      GO
    `
  },
  {
    filename: 'trigger-turnoclosurecomplete.sql',
    description: 'Creating trgTurnosShiftClosureComplete trigger',
    fallbackSQL: `
      SET ANSI_NULLS ON
      GO
      SET QUOTED_IDENTIFIER ON
      GO
      IF NOT EXISTS (SELECT * FROM sys.triggers WHERE object_id = OBJECT_ID(N'[dbo].[trgTurnosShiftClosureComplete]'))
      BEGIN
      EXEC dbo.sp_executesql @statement = N'
      CREATE TRIGGER [dbo].[trgTurnosShiftClosureComplete]
      ON [dbo].[TurnoEvents]
      AFTER INSERT
      AS
      BEGIN
          SET NOCOUNT ON;
          
          -- Only process records related to shift closure
          IF EXISTS (SELECT 1 FROM inserted WHERE OperationType = ''CLOSE'' AND Status = ''CLOSED'')
          BEGIN
              -- Mark the shift closure as complete
              UPDATE scs
              SET 
                  scs.Status = ''COMPLETED'',
                  scs.EndTime = GETDATE()
              FROM ShiftClosureState scs
              INNER JOIN inserted i ON scs.ShiftId = i.IdTurnoInterno
              WHERE i.OperationType = ''CLOSE''
                  AND i.Status = ''CLOSED''
                  AND scs.Status = ''ACTIVE'';
              
              -- Log the completion
              INSERT INTO ShiftLog (EventType, ShiftId, Details)
              SELECT 
                  ''SHIFT_CLOSURE_COMPLETED'',
                  i.IdTurnoInterno,
                  ''Shift closure process completed. Total amounts: Efectivo='' + 
                      ISNULL(CAST(i.Efectivo AS VARCHAR), ''0'') + 
                      '', Tarjeta='' + ISNULL(CAST(i.Tarjeta AS VARCHAR), ''0'') +
                      '', Vales='' + ISNULL(CAST(i.Vales AS VARCHAR), ''0'') +
                      '', Credito='' + ISNULL(CAST(i.Credito AS VARCHAR), ''0'')
              FROM inserted i
              WHERE i.OperationType = ''CLOSE''
                  AND i.Status = ''CLOSED'';
          END
      END
      ' 
      END
      GO
    `
  }
]

// Function to check SQL Server connectivity
async function checkSqlServerConnection(dbConfig) {
  console.log('\n========== SQL SERVER CONNECTION TEST ==========')
  console.log('Testing connection to SQL Server with these parameters:')
  console.log(`Server: ${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}`)
  console.log(`Database: ${dbConfig.database}`)
  console.log(`User: ${dbConfig.user}`)
  console.log(`Password: ${dbConfig.password ? '********' : '[EMPTY OR UNDEFINED]'}`)

  // Check if sqlcmd is available
  let sqlcmdAvailable = false
  try {
    execSync('sqlcmd -?', { stdio: 'ignore' })
    sqlcmdAvailable = true
    console.log('\nSQLCMD utility is available')
  } catch (err) {
    console.log('\nSQLCMD utility is not available. Will attempt PowerShell SQL connection test.')
  }

  if (sqlcmdAvailable) {
    try {
      // Very simple connection test with sqlcmd
      const sqlcmdArgs = `-S "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}" -d "master" -U "${dbConfig.user}" -P "${dbConfig.password || ''}" -Q "SELECT @@VERSION" -t 5`

      console.log(`\nExecuting: sqlcmd ${sqlcmdArgs.replace(dbConfig.password || '', '********')}`)

      try {
        const result = execSync(`sqlcmd ${sqlcmdArgs}`, { encoding: 'utf8' })
        console.log('\n✅ SQL Server connection successful! Server version:')
        console.log(result.trim())
        return true
      } catch (error) {
        console.error('\n❌ SQL Server connection failed:')
        console.error(error.message)

        // Provide more specific guidance based on error message
        if (error.message.includes('Login failed for user')) {
          console.error('\nLOGIN FAILED: The username or password is incorrect.')
          console.error('Please check your .env file or configuration to ensure correct credentials.')
        } else if (error.message.includes('Named Pipes Provider') || error.message.includes('Login timeout expired')) {
          console.error('\nCONNECTION FAILED: SQL Server is not running or not accessible.')
          console.error('Possible causes:')
          console.error('1. SQL Server service is not running')
          console.error('2. Server name is incorrect')
          console.error('3. SQL Server is not allowing remote connections')
          console.error('4. Firewall is blocking SQL Server port (default: 1433)')
        }

        return false
      }
    } catch (err) {
      console.error('\n❌ Error testing SQL Server connection:', err.message)
      return false
    }
  } else {
    // Try PowerShell approach for connection test
    try {
      const psScript = `
$server = "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}"
$database = "master" # Use master for the connection test
$user = "${dbConfig.user}"
$password = "${dbConfig.password || ''}"

Write-Host "Testing connection to SQL Server: $server"
Write-Host "User: $user"

try {
    $connectionString = "Server=$server;Database=$database;User Id=$user;Password=$password;Connection Timeout=5;"
    $connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
    $connection.Open()
    
    $query = "SELECT @@VERSION"
    $command = New-Object System.Data.SqlClient.SqlCommand $query, $connection
    $result = $command.ExecuteScalar()
    
    Write-Host "✅ SQL Server connection successful! Server version:"
    Write-Host $result
    
    $connection.Close()
    exit 0
} catch {
    Write-Host "❌ SQL Server connection failed:"
    Write-Host $_.Exception.Message
    exit 1
}
`
      const psScriptPath = path.join(os.tmpdir(), 'avoqado_test_connection.ps1')
      fs.writeFileSync(psScriptPath, psScript)

      try {
        const result = execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { encoding: 'utf8' })
        console.log(result.trim())
        return true
      } catch (error) {
        console.error('\n❌ PowerShell SQL Server connection test failed:')
        if (error.stdout) console.error(error.stdout.trim())

        console.error('\nPossible causes:')
        console.error('1. SQL Server service is not running')
        console.error('2. Server name is incorrect')
        console.error('3. Username or password is incorrect')
        console.error('4. SQL Server is not allowing remote connections')
        console.error('5. Firewall is blocking SQL Server port (default: 1433)')

        return false
      } finally {
        try {
          fs.unlinkSync(psScriptPath)
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      console.error('\n❌ Error testing SQL Server connection using PowerShell:', err.message)
      return false
    }
  }
}

// Function to check if the database exists
async function checkDatabaseExists(dbConfig) {
  console.log('\n========== DATABASE EXISTENCE CHECK ==========')

  // Check if sqlcmd is available
  let sqlcmdAvailable = false
  try {
    execSync('sqlcmd -?', { stdio: 'ignore' })
    sqlcmdAvailable = true
  } catch (err) {
    // SQLCMD not available, will use PowerShell
  }

  if (sqlcmdAvailable) {
    try {
      // Check if database exists
      const sqlcmdArgs = `-S "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}" -d "master" -U "${dbConfig.user}" -P "${dbConfig.password || ''}" -Q "SELECT name FROM sys.databases WHERE name = '${dbConfig.database}'" -h -1`

      try {
        const result = execSync(`sqlcmd ${sqlcmdArgs}`, { encoding: 'utf8' })

        if (result.trim().includes(dbConfig.database)) {
          console.log(`✅ Database '${dbConfig.database}' exists.`)
          return true
        } else {
          console.log(`❌ Database '${dbConfig.database}' does not exist.`)

          // Ask if user wants to create the database
          console.log('\nWould you like to create the database now? (y/n)')
          const answer = await new Promise((resolve) => {
            process.stdin.once('data', (data) => {
              resolve(data.toString().trim().toLowerCase())
            })
          })

          if (answer === 'y' || answer === 'yes') {
            // Create the database
            const createDbArgs = `-S "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}" -d "master" -U "${dbConfig.user}" -P "${dbConfig.password || ''}" -Q "CREATE DATABASE [${dbConfig.database}]"`

            try {
              execSync(`sqlcmd ${createDbArgs}`, { stdio: 'inherit' })
              console.log(`✅ Database '${dbConfig.database}' created successfully.`)
              return true
            } catch (error) {
              console.error(`❌ Failed to create database '${dbConfig.database}':`, error.message)
              return false
            }
          } else {
            console.log(`Skipping database creation for '${dbConfig.database}'.`)
            return false
          }
        }
      } catch (error) {
        console.error('❌ Error checking if database exists:', error.message)
        return false
      }
    } catch (err) {
      console.error('Error checking database existence:', err.message)
      return false
    }
  } else {
    // Use PowerShell approach
    try {
      const psScript = `
$server = "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}"
$database = "${dbConfig.database}"
$user = "${dbConfig.user}"
$password = "${dbConfig.password || ''}"

try {
    $connectionString = "Server=$server;Database=master;User Id=$user;Password=$password;"
    $connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
    $connection.Open()
    
    $query = "SELECT name FROM sys.databases WHERE name = '$database'"
    $command = New-Object System.Data.SqlClient.SqlCommand $query, $connection
    $result = $command.ExecuteScalar()
    
    if ($result -eq $database) {
        Write-Host "✅ Database '$database' exists."
        $connection.Close()
        exit 0
    } else {
        Write-Host "❌ Database '$database' does not exist."
        Write-Host "Would you like to create the database now? (y/n)"
        $answer = Read-Host
        
        if ($answer -eq 'y' -or $answer -eq 'yes') {
            $createQuery = "CREATE DATABASE [$database]"
            $createCommand = New-Object System.Data.SqlClient.SqlCommand $createQuery, $connection
            $createCommand.ExecuteNonQuery()
            Write-Host "✅ Database '$database' created successfully."
            $connection.Close()
            exit 0
        } else {
            Write-Host "Skipping database creation for '$database'."
            $connection.Close()
            exit 1
        }
    }
} catch {
    Write-Host "❌ Error checking if database exists:"
    Write-Host $_.Exception.Message
    exit 1
}
`
      const psScriptPath = path.join(os.tmpdir(), 'avoqado_check_database.ps1')
      fs.writeFileSync(psScriptPath, psScript)

      try {
        const result = execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { encoding: 'utf8', stdio: 'inherit' })
        return true
      } catch (error) {
        console.error('❌ Database check or creation failed')
        return false
      } finally {
        try {
          fs.unlinkSync(psScriptPath)
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      console.error('Error checking database existence using PowerShell:', err.message)
      return false
    }
  }
}

// Main function to run the diagnostics and setup
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║       Avoqado POS Database Setup & Diagnostics Tool      ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  // Get database configuration
  const dbConfig = createDbConfig()

  // Check SQL Server connection
  const connectionSuccessful = await checkSqlServerConnection(dbConfig)

  if (!connectionSuccessful) {
    console.error('\n========== CONNECTION TROUBLESHOOTING ==========')
    console.error('1. Make sure SQL Server is installed and running')
    console.error('2. Verify your connection parameters in the .env file:')
    console.error(`   - Current server: ${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}`)
    console.error(`   - Current user: ${dbConfig.user}`)
    console.error(`   - Current database: ${dbConfig.database}`)
    console.error(`   - Password: ${dbConfig.password ? 'Provided' : 'Missing or Empty'}`)
    console.error('3. Make sure the SQL Server service is running:')
    console.error('   - Open Services (services.msc)')
    console.error('   - Look for "SQL Server (MSSQLSERVER)" or "SQL Server (SQLEXPRESS)"')
    console.error('   - Ensure its status is "Running"')
    console.error('\nWould you like to open the SQL Server Configuration Manager now? (y/n)')

    const answer = await new Promise((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim().toLowerCase())
      })
    })

    if (answer === 'y' || answer === 'yes') {
      try {
        console.log('Attempting to open SQL Server Configuration Manager...')
        execSync('start SQLServerManager15.msc || start SQLServerManager14.msc || start SQLServerManager13.msc || start SQLServerManager12.msc', { shell: true })
      } catch (error) {
        console.log('Could not open SQL Server Configuration Manager automatically.')
        console.log('Please open it manually from the Windows Start menu.')
      }
    }

    console.error('\nPlease fix the connection issues and run this script again.')
    process.exit(1)
  }

  // Check if database exists
  const databaseExists = await checkDatabaseExists(dbConfig)

  if (!databaseExists) {
    console.error(`\nDatabase '${dbConfig.database}' does not exist or could not be created.`)
    console.error('Please create the database manually and run this script again.')
    process.exit(1)
  }

  console.log('\n========== DATABASE SETUP ==========')
  console.log('All diagnostic checks have passed. Proceeding with database setup...')
  console.log(`Database: ${dbConfig.database}`)

  // At this point, we can proceed with the actual database setup

  // Ensure SQL script directory exists
  if (!fs.existsSync(sqlScriptPath)) {
    fs.mkdirSync(sqlScriptPath, { recursive: true })
  }

  // Create SQL scripts from fallback if they don't exist
  for (const sqlFileInfo of sqlFiles) {
    if (sqlFileInfo.fallbackSQL) {
      const filePath = path.join(sqlScriptPath, sqlFileInfo.filename)
      if (!fs.existsSync(filePath)) {
        console.log(`Creating SQL file from fallback: ${sqlFileInfo.filename}`)
        fs.writeFileSync(filePath, sqlFileInfo.fallbackSQL)
      }
    }
  }

  // Execute SQL files
  const sqlFilesToExecute = fs.readdirSync(sqlScriptPath).filter((file) => file.endsWith('.sql'))
  console.log(`\nFound ${sqlFilesToExecute.length} SQL files to execute`)

  // Check if sqlcmd is available
  let sqlcmdAvailable = false
  try {
    execSync('sqlcmd -?', { stdio: 'ignore' })
    sqlcmdAvailable = true
  } catch (err) {
    // SQLCMD not available, will use PowerShell
  }

  let successCount = 0

  for (const sqlFile of sqlFilesToExecute) {
    console.log(`\nExecuting: ${sqlFile}`)
    const scriptPath = path.join(sqlScriptPath, sqlFile)

    if (sqlcmdAvailable) {
      try {
        // Execute with SQLCMD
        const sqlcmdArgs = `-S "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}" -d "${dbConfig.database}" -U "${dbConfig.user}" -P "${dbConfig.password || ''}" -I -i "${scriptPath}"`
        execSync(`sqlcmd ${sqlcmdArgs}`, { stdio: 'inherit' })
        console.log(`✅ Successfully executed ${sqlFile}`)
        successCount++
      } catch (error) {
        console.error(`❌ Error executing SQL file ${sqlFile} with sqlcmd:`, error.message)
      }
    } else {
      try {
        // Read the SQL file
        const sqlContent = fs.readFileSync(scriptPath, 'utf8')

        // Split by GO to handle batches
        const sqlBatches = sqlContent.split(/\nGO\s*$/im)

        // Write PowerShell script to execute SQL
        const psScript = `
$server = "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}"
$database = "${dbConfig.database}"
$user = "${dbConfig.user}"
$password = "${dbConfig.password || ''}"

$connectionString = "Server=$server;Database=$database;User Id=$user;Password=$password;"
$connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
$connection.Open()

$scriptPath = "${scriptPath}"
Write-Host "Executing script: $scriptPath"

${sqlBatches
  .filter((batch) => batch.trim())
  .map(
    (batch, i) => `
# Batch ${i + 1}
$sql = @"
${batch.trim()}
"@

Write-Host "Executing batch ${i + 1}..."
$command = New-Object System.Data.SqlClient.SqlCommand $sql, $connection
try {
    $command.ExecuteNonQuery() | Out-Null
    Write-Host "Batch ${i + 1} executed successfully"
} catch {
    Write-Host "Error in batch ${i + 1}: $_"
    # Continue with next batch
}
`
  )
  .join('\n')}

$connection.Close()
Write-Host "Execution of $scriptPath completed"
`
        const psScriptPath = path.join(os.tmpdir(), `avoqado_execute_${sqlFile.replace('.sql', '')}.ps1`)
        fs.writeFileSync(psScriptPath, psScript)

        try {
          execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' })
          console.log(`✅ Successfully executed ${sqlFile} with PowerShell`)
          successCount++
        } catch (error) {
          console.error(`❌ Error executing SQL file ${sqlFile} with PowerShell:`, error.message)
        }

        try {
          fs.unlinkSync(psScriptPath)
        } catch (err) {
          // Ignore cleanup errors
        }
      } catch (error) {
        console.error(`❌ Error processing SQL file ${sqlFile}:`, error.message)
      }
    }
  }

  console.log(`\n${successCount} of ${sqlFilesToExecute.length} SQL scripts executed successfully`)

  if (successCount === sqlFilesToExecute.length) {
    console.log('\n✅ Database setup completed successfully')
  } else {
    console.log(`\n⚠️ Database setup completed with ${sqlFilesToExecute.length - successCount} errors.`)
    console.log('Some tables or objects may not have been created correctly.')
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║                     Next Steps                           ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('Install and start the Windows service:')
  console.log('   npm run install-service')

  process.exit(successCount === sqlFilesToExecute.length ? 0 : 1)
}

// Run the main function
main().catch((error) => {
  console.error('\n❌ Error during database setup:', error.message)
  process.exit(1)
})
