// main-app.cjs - Main entry point for the installed application
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs') // Regular fs for sync methods like existsSync
const fsPromises = require('fs').promises // Promise-based fs for async methods
const { execSync, spawn } = require('child_process')
const sql = require('mssql')
const os = require('os')

// ===== FIX 1: DISABLE HARDWARE ACCELERATION AND GPU FEATURES =====
// This prevents the cache errors you're seeing
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-cache')

// ===== FIX 2: IMPLEMENT SINGLE INSTANCE LOCK =====
// This prevents multiple windows from opening
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('Another instance is already running. Exiting.')
  app.quit()
  return
}

// Set up second-instance handler
app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Someone tried to run a second instance, focus our window instead
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ===== ORIGINAL CODE CONTINUES FROM HERE =====
// Set up error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  if (mainWindow) {
    mainWindow.webContents.send('script-error', `Application Error: ${error.message}`)
  }
})

// Determine if we're running in production or development
const isProduction = !process.defaultApp && !process.env.NODE_ENV?.includes('dev')
console.log(`Running in ${isProduction ? 'production' : 'development'} mode`)

// Define paths for different environments
let mainWindow
let userDataPath
let configFilePath
let resourcesPath

// Set up paths based on environment
if (isProduction) {
  // In production/installed mode
  userDataPath = app.getPath('userData')
  configFilePath = path.join(userDataPath, '.env')
  resourcesPath = process.resourcesPath
} else {
  // In development mode
  userDataPath = app.getPath('userData')
  configFilePath = path.join(path.resolve(__dirname, '..', '..'), '.env')
  resourcesPath = path.resolve(__dirname, '..', '..')
}

console.log('User data path:', userDataPath)
console.log('Config file path:', configFilePath)
console.log('Resources path:', resourcesPath)

// Icon path - look in different locations based on environment
let iconPath
if (isProduction) {
  iconPath = path.join(resourcesPath, 'scripts', 'installer', 'assets', 'icon.ico')
} else {
  iconPath = path.join(__dirname, 'assets', 'icon.ico')
}

function createWindow() {
  try {
    console.log('Creating main window...')

    mainWindow = new BrowserWindow({
      width: 800,
      resizable: false,
      height: 600,
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
      console.error('Failed to load HTML file:', error)
    })

    // Show menu bar only in development mode
    mainWindow.setMenuBarVisibility(!isProduction)

    // Open DevTools only in development mode
    if (!isProduction) {
      mainWindow.webContents.openDevTools()
    }

    // After window is created, check if configuration exists
    checkConfigurationExists()
  } catch (error) {
    console.error('Failed to create window:', error)
  }
}

// Check if configuration exists and notify renderer
function checkConfigurationExists() {
  if (!fs.existsSync(configFilePath)) {
    console.log('Configuration file not found, setup needed:', configFilePath)

    // Create the userData directory if it doesn't exist (for first run)
    if (!fs.existsSync(path.dirname(configFilePath))) {
      fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
    }

    // Copy .env.example if needed
    const exampleEnvPath = path.join(resourcesPath, '.env.example')
    if (fs.existsSync(exampleEnvPath)) {
      try {
        fs.copyFileSync(exampleEnvPath, path.join(userDataPath, '.env.example'))
        console.log('Copied example .env file to user data directory')
      } catch (error) {
        console.error('Error copying example config:', error)
      }
    }

    // Let renderer know configuration is needed
    if (mainWindow) {
      setTimeout(() => {
        mainWindow.webContents.send('configuration-status', { exists: false })
      }, 1000) // Small delay to ensure renderer is ready
    }
  } else {
    console.log('Configuration file found:', configFilePath)
    if (mainWindow) {
      setTimeout(() => {
        mainWindow.webContents.send('configuration-status', { exists: true })
      }, 1000) // Small delay to ensure renderer is ready
    }
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Handle fetch databases request
ipcMain.on('fetch-databases', async (event, credentials) => {
  console.log('Received fetch-databases request with credentials:', credentials)

  try {
    // Create connection config
    const connectionConfig = {
      user: credentials.user,
      password: credentials.password,
      server: credentials.server,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        connectTimeout: 15000
      }
    }

    // Add instance name if provided
    if (credentials.instance) {
      connectionConfig.options.instanceName = credentials.instance
    }

    // Connect to master database to get list of all databases
    connectionConfig.database = 'master'

    console.log('Connecting to SQL Server to fetch databases...')
    const pool = await sql.connect(connectionConfig)

    // Query to get all databases
    const result = await pool.request().query(`
      SELECT name 
      FROM sys.databases 
      WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') 
      ORDER BY name
    `)

    // Close the connection
    await pool.close()

    // Extract database names and send to renderer
    const databases = result.recordset
    console.log(`Found ${databases.length} databases:`, databases)

    // Send database list to renderer
    event.reply('database-list', databases)
  } catch (error) {
    console.error('Error fetching databases:', error.message)
    event.reply('script-error', `Failed to fetch databases: ${error.message}`)
  }
})

// Handle save configuration message from renderer
ipcMain.on('save-config', async (event, config) => {
  console.log('Received save-config event with data:', config)
  event.reply('script-output', 'Saving configuration...')
  const HARD_CODED_RABBITMQ_URL = 'amqps://wkdeleat:E-37pD2qqZfeEzOoZ1VwnREE2oUqKnr8@moose.rmq.cloudamqp.com/wkdeleat'
  const HARD_CODED_REQUEST_QUEUE = 'operations_queue'
  const HARD_CODED_RESPONSE_QUEUE = 'operations_queue'

  try {
    // Generate .env content
    let envContent = `# Avoqado POS Service Configuration\n# Generated by setup utility\n\n`

    // Add venue ID
    envContent += `# Venue configuration\nVENUE_ID=${config.venueId}\n\n`

    // Add database configuration
    envContent += `# Database configuration\n`

    if (config.configType === 'details') {
      envContent += `DB_USER=${config.dbUser}\n`
      envContent += `DB_PASSWORD=${config.dbPassword}\n`
      envContent += `DB_SERVER=${config.dbServer}\n`
      envContent += `DB_DATABASE=${config.dbName}\n`
      if (config.dbInstance) {
        envContent += `DB_INSTANCE=${config.dbInstance}\n`
      }
    } else {
      envContent += `DB_CONNECTION_STRING=${config.connectionString}\n`
    }

    envContent += `\n# RabbitMQ configuration\n`
    envContent += `RABBITMQ_URL=${HARD_CODED_RABBITMQ_URL}\n`
    envContent += `REQUEST_QUEUE=${HARD_CODED_REQUEST_QUEUE}\n`
    envContent += `RESPONSE_QUEUE=${HARD_CODED_RESPONSE_QUEUE}\n`

    // Write the .env file to the correct location based on environment
    console.log(`Writing configuration to: ${configFilePath}`)
    await fsPromises.writeFile(configFilePath, envContent)
    event.reply('script-output', `Configuration saved to ${configFilePath}`)

    // Test connections if requested
    let dbConnected = false
    if (config.testConnections) {
      event.reply('script-output', '\nTesting connections...')

      // Test database connection
      try {
        let connectionConfig

        if (config.configType === 'details') {
          connectionConfig = {
            user: config.dbUser,
            password: config.dbPassword,
            database: config.dbName,
            server: config.dbServer,
            options: {
              encrypt: false,
              trustServerCertificate: true
            }
          }

          // Add instance name if provided
          if (config.dbInstance) {
            connectionConfig.options.instanceName = config.dbInstance
          }
        } else {
          // Using connection string
          connectionConfig = {
            connectionString: config.connectionString
          }
        }

        event.reply('script-output', 'Connecting to database...')
        const pool = await sql.connect(connectionConfig)
        event.reply('script-output', '✅ Database connection successful!')
        await pool.close()
        dbConnected = true
      } catch (error) {
        event.reply('script-error', `❌ Database connection failed: ${error.message}`)
        dbConnected = false
      }

      // Test RabbitMQ connection (optional)
      let rabbitmqConnected = false
      try {
        const amqp = require('amqplib')
        event.reply('script-output', 'Connecting to RabbitMQ...')
        // Use the hardcoded URL directly
        const connection = await amqp.connect(HARD_CODED_RABBITMQ_URL)
        event.reply('script-output', '✅ RabbitMQ connection successful!')
        await connection.close()
        rabbitmqConnected = true
      } catch (error) {
        event.reply('script-error', `❌ RabbitMQ connection failed: ${error.message}`)
        // We'll continue even if RabbitMQ fails for now
      }
    } else {
      // If not testing connections, assume everything is ok
      dbConnected = true
    }

    // Display next steps
    event.reply('script-output', '\nNext steps:')
    event.reply('script-output', '1. Set up the database by clicking "Next" and running the database setup')
    event.reply('script-output', '2. Install the Windows service')

    // Only send script-complete if database connection was successful or if we're not testing connections
    if (dbConnected) {
      event.reply('script-complete', 'Configuration completed successfully')
    } else {
      event.reply('script-output', '\n⚠️ Please fix the database connection issues before continuing.')
    }
  } catch (error) {
    event.reply('script-error', `Error saving configuration: ${error.message}`)
  }
})

// Handle IPC messages from renderer for running scripts
ipcMain.on('run-db-setup', (event) => {
  console.log('Received run-db-setup event')
  runScriptWithProgress('setup-db', event)
})

ipcMain.on('install-service', (event) => {
  console.log('Received install-service event')
  runScriptWithProgress('install-service', event)
})

ipcMain.on('uninstall-service', (event) => {
  console.log('Received uninstall-service event')
  runScriptWithProgress('uninstall-service', event)
})

// ===== IMPROVED SCRIPT RUNNER =====
// Enhanced with better path resolution, error handling, and environment variables
function runScriptWithProgress(scriptName, event) {
  // Try different paths based on environment - enhanced with more possibilities
  const possiblePaths = [
    // First check in the app.asar.unpacked folder (for packaged app)
    path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'installer', `${scriptName}.cjs`),
    // Then in resources/scripts/installer (for extraResources)
    path.join(process.resourcesPath, 'scripts', 'installer', `${scriptName}.cjs`),
    // Then try the current directory (for development)
    path.join(__dirname, `${scriptName}.cjs`),
    // Also check parent directories
    path.join(__dirname, '..', 'installer', `${scriptName}.cjs`)
  ]

  // Find first existing path
  let scriptPath = null
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      scriptPath = p
      break
    }
  }

  console.log(`Attempting to run script: ${scriptPath}`)
  event.reply('script-output', `Starting ${scriptName}...`)
  event.reply('script-output', `Script path: ${scriptPath}`)

  // Check if file exists
  if (!scriptPath) {
    console.error(`Script not found: ${scriptName}.cjs`)
    event.reply('script-error', `Script not found: ${scriptName}.cjs`)
    console.log('Checked paths:', possiblePaths)
    event.reply('script-output', 'Checked these paths:')
    possiblePaths.forEach((p) => {
      event.reply('script-output', `- ${p}`)
    })
    return
  }

  try {
    console.log(`Found script, executing: ${scriptPath}`)

    // Generate the NODE_PATH environment variable to help with module resolution
    const nodePaths = [path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'), path.join(process.resourcesPath, 'node_modules'), path.dirname(process.execPath)].join(path.delimiter)

    // ===== USE ELECTRON'S EXECUTABLE WITH ENVIRONMENT VARIABLES =====
    // This ensures better compatibility with the packaged app
    const child = spawn(process.execPath, ['--no-warnings', scriptPath], {
      shell: false, // Don't use shell - this avoids path quoting issues
      env: {
        ...process.env,
        APP_DATA_PATH: userDataPath,
        APP_IS_PACKAGED: isProduction ? 'true' : 'false',
        CONFIG_FILE_PATH: configFilePath,
        RESOURCES_PATH: resourcesPath,
        ELECTRON_RUN_AS_NODE: '1', // Force Node.js mode for child process
        NODE_PATH: nodePaths // Add NODE_PATH to help resolve modules
      }
    })

    child.stdout.on('data', (data) => {
      const output = data.toString()
      console.log(`Script stdout: ${output}`)
      event.reply('script-output', output)
    })

    child.stderr.on('data', (data) => {
      const error = data.toString()
      console.error(`Script stderr: ${error}`)
      event.reply('script-error', error)
    })

    child.on('error', (error) => {
      console.error(`Failed to start script: ${error.message}`)
      event.reply('script-error', `Failed to start script: ${error.message}`)
    })

    child.on('close', (code) => {
      console.log(`Script exited with code ${code}`)
      if (code === 0) {
        event.reply('script-complete', `${scriptName} completed successfully`)
      } else {
        event.reply('script-error', `${scriptName} exited with code ${code}`)
      }
    })
  } catch (error) {
    console.error(`Error executing script: ${error.message}`)
    event.reply('script-error', `Error executing script: ${error.message}`)
  }
}
