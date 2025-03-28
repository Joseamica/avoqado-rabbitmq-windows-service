// CommonJS version of setup.cjs
const inquirer = require('inquirer')
const fs = require('fs')
const fsPromises = fs.promises
const path = require('path')
const sql = require('mssql')
const amqp = require('amqplib')
const os = require('os')

// FIXED: Always use a consistent path in AppData for configuration
// This is critical for the Windows service to find it later
const appDataConfigDir = path.join(os.homedir(), 'AppData', 'Roaming', 'avoqado-pos-service')
const primaryEnvPath = path.join(appDataConfigDir, '.env')

// Create the primary config directory if it doesn't exist
if (!fs.existsSync(appDataConfigDir)) {
  try {
    fs.mkdirSync(appDataConfigDir, { recursive: true })
    console.log(`Created app data directory: ${appDataConfigDir}`)
  } catch (err) {
    console.error(`CRITICAL ERROR: Could not create app data directory: ${err.message}`)
    console.error('The application may not function correctly without this directory.')
    // Continue anyway - we'll try to save to other locations as fallback
  }
}

// Function to save config to primary and backup locations
async function saveConfiguration(envContent) {
  const saveLocations = []
  const savedSuccessfully = []

  // PRIMARY LOCATION: Always try AppData first
  saveLocations.push({
    path: primaryEnvPath,
    description: 'Primary AppData location (used by Windows service)'
  })

  // BACKUP LOCATION 1: Project directory (for development mode)
  const rootPath = path.resolve(__dirname, '..', '..')
  const projectEnvPath = path.join(rootPath, '.env')

  saveLocations.push({
    path: projectEnvPath,
    description: 'Project directory (for development mode)'
  })

  // BACKUP LOCATION 2: User data path (for standalone mode)
  if (process.env.APP_DATA_PATH) {
    const userDataEnvPath = path.join(process.env.APP_DATA_PATH, '.env')
    saveLocations.push({
      path: userDataEnvPath,
      description: 'Electron user data path'
    })
  }

  // Save to all locations
  for (const location of saveLocations) {
    try {
      // Ensure the directory exists
      const dirPath = path.dirname(location.path)
      if (!fs.existsSync(dirPath)) {
        await fsPromises.mkdir(dirPath, { recursive: true })
      }

      // Write the file
      await fsPromises.writeFile(location.path, envContent)
      console.log(`✅ Configuration saved to ${location.path} (${location.description})`)
      savedSuccessfully.push(location.path)
    } catch (error) {
      console.error(`❌ Failed to save to ${location.path}: ${error.message}`)
    }
  }

  return savedSuccessfully.length > 0
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           Avoqado POS Service Setup Utility              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('This utility will help you configure the service settings.\n')
  console.log(`Primary configuration location: ${primaryEnvPath}`)

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'venueId',
      message: 'Enter your Venue ID:',
      default: 'default-venue',
      validate: (input) => (input.trim() !== '' ? true : 'Venue ID cannot be empty')
    },
    {
      type: 'list',
      name: 'configType',
      message: 'How would you like to configure your database connection?',
      choices: [
        { name: 'Enter connection details individually', value: 'details' },
        { name: 'Enter a full connection string', value: 'string' }
      ]
    },
    {
      type: 'input',
      name: 'dbServer',
      message: 'Database server address:',
      default: 'localhost',
      when: (answers) => answers.configType === 'details'
    },
    {
      type: 'input',
      name: 'dbInstance',
      message: 'SQL Server instance name (leave empty if using default instance):',
      default: 'NATIONALSOFT',
      when: (answers) => answers.configType === 'details'
    },
    {
      type: 'input',
      name: 'dbName',
      message: 'Database name:',
      default: 'avo',
      when: (answers) => answers.configType === 'details'
    },
    {
      type: 'input',
      name: 'dbUser',
      message: 'Database username:',
      default: 'sa',
      when: (answers) => answers.configType === 'details'
    },
    {
      type: 'password',
      name: 'dbPassword',
      message: 'Database password:',
      mask: '*',
      when: (answers) => answers.configType === 'details'
    },
    {
      type: 'input',
      name: 'connectionString',
      message: 'Enter your full database connection string:',
      when: (answers) => answers.configType === 'string',
      validate: (input) => (input.trim() !== '' ? true : 'Connection string cannot be empty')
    },
    {
      type: 'input',
      name: 'rabbitmqUrl',
      message: 'RabbitMQ connection URL:',
      default: 'amqps://wkdeleat:E-37pD2qqZfeEzOoZ1VwnREE2oUqKnr8@moose.rmq.cloudamqp.com/wkdeleat'
    },
    {
      type: 'input',
      name: 'requestQueue',
      message: 'Request queue name (for receiving commands from cloud):',
      default: 'operations_queue'
    },
    {
      type: 'input',
      name: 'responseQueue',
      message: 'Response queue name (for sending responses to cloud):',
      default: 'responses_queue'
    },
    {
      type: 'confirm',
      name: 'testConnections',
      message: 'Would you like to test the database and RabbitMQ connections?',
      default: true
    }
  ])

  // Test connections if requested
  if (answers.testConnections) {
    console.log('\nTesting connections...')

    // Test database connection
    let dbConnected = false
    try {
      let connectionConfig

      if (answers.configType === 'details') {
        connectionConfig = {
          user: answers.dbUser,
          password: answers.dbPassword,
          database: answers.dbName,
          server: answers.dbServer,
          options: {
            encrypt: false,
            trustServerCertificate: true,
            connectTimeout: 15000
          }
        }

        // Add instance name if provided
        if (answers.dbInstance) {
          connectionConfig.options.instanceName = answers.dbInstance
        }
      } else {
        // Using connection string
        connectionConfig = {
          connectionString: answers.connectionString
        }
      }

      console.log('Connecting to database...')
      const pool = await sql.connect(connectionConfig)
      console.log('✅ Database connection successful!')
      await pool.close()
      dbConnected = true
    } catch (error) {
      console.error('❌ Database connection failed:', error.message)
      const continueAnyway = await inquirer.prompt({
        type: 'confirm',
        name: 'continue',
        message: 'Database connection failed. Continue with configuration anyway?',
        default: false
      })

      if (!continueAnyway.continue) {
        console.log('Setup aborted. Please check your database connection details and try again.')
        process.exit(1)
      }
    }

    // Test RabbitMQ connection
    let rmqConnected = false
    try {
      console.log('Connecting to RabbitMQ...')
      const connection = await amqp.connect(answers.rabbitmqUrl)
      console.log('✅ RabbitMQ connection successful!')
      await connection.close()
      rmqConnected = true
    } catch (error) {
      console.error('❌ RabbitMQ connection failed:', error.message)
      const continueAnyway = await inquirer.prompt({
        type: 'confirm',
        name: 'continue',
        message: 'RabbitMQ connection failed. Continue with configuration anyway?',
        default: false
      })

      if (!continueAnyway.continue) {
        console.log('Setup aborted. Please check your RabbitMQ connection details and try again.')
        process.exit(1)
      }
    }

    // Warn if both connections failed
    if (!dbConnected && !rmqConnected) {
      console.warn('\n⚠️ WARNING: Both database and RabbitMQ connections failed.')
      console.warn('The service may not work correctly with this configuration.')
    }
  }

  // Generate .env content
  const envContent = `# Avoqado POS Service Configuration
# Generated by setup utility on ${new Date().toISOString()}

# Venue configuration
VENUE_ID=${answers.venueId}

# Database configuration
${
  answers.configType === 'details'
    ? `DB_USER=${answers.dbUser}
DB_PASSWORD=${answers.dbPassword}
DB_SERVER=${answers.dbServer}
DB_DATABASE=${answers.dbName}${answers.dbInstance ? `\nDB_INSTANCE=${answers.dbInstance}` : ''}`
    : `DB_CONNECTION_STRING=${answers.connectionString}`
}

# RabbitMQ configuration
RABBITMQ_URL=${answers.rabbitmqUrl}
REQUEST_QUEUE=${answers.requestQueue}
RESPONSE_QUEUE=${answers.responseQueue}
`

  // Write the .env file to multiple locations
  try {
    const saveSuccessful = await saveConfiguration(envContent)

    if (saveSuccessful) {
      // Provide next steps
      console.log('\n╔══════════════════════════════════════════════════════════╗')
      console.log('║                     Next Steps                           ║')
      console.log('╚══════════════════════════════════════════════════════════╝')
      console.log('1. Run the SQL setup script to enable Change Tracking:')
      console.log('   npm run setup-db')
      console.log('\n2. Install and start the Windows service:')
      console.log('   npm run install-service')
      console.log('\nOr to run without installing as a service:')
      console.log('   npm start')
      console.log('\nThank you for using Avoqado POS Service!')
    } else {
      console.error('\n❌ Failed to save configuration to any location.')
      process.exit(1)
    }
  } catch (error) {
    console.error(`\n❌ Error saving configuration: ${error.message}`)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('An unexpected error occurred:', error)
  process.exit(1)
})
