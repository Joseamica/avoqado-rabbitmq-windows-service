// CommonJS version of setup.js
const inquirer = require('inquirer')
const fs = require('fs').promises
const path = require('path')
const sql = require('mssql')
const amqp = require('amqplib')

// Calculate paths
const rootPath = path.resolve(__dirname, '..', '..')
const envPath = path.join(rootPath, '.env')

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           Avoqado POS Service Setup Utility              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('This utility will help you configure the service settings.\n')

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
            trustServerCertificate: true
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
    try {
      console.log('Connecting to RabbitMQ...')
      const connection = await amqp.connect(answers.rabbitmqUrl)
      console.log('✅ RabbitMQ connection successful!')
      await connection.close()
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
  }

  // Generate .env content
  let envContent = `# Avoqado POS Service Configuration\n# Generated by setup utility\n\n`

  // Add venue ID
  envContent += `# Venue configuration\nVENUE_ID=${answers.venueId}\n\n`

  // Add database configuration
  envContent += `# Database configuration\n`

  if (answers.configType === 'details') {
    envContent += `DB_USER=${answers.dbUser}\n`
    envContent += `DB_PASSWORD=${answers.dbPassword}\n`
    envContent += `DB_SERVER=${answers.dbServer}\n`
    envContent += `DB_DATABASE=${answers.dbName}\n`
    if (answers.dbInstance) {
      envContent += `DB_INSTANCE=${answers.dbInstance}\n`
    }
  } else {
    envContent += `DB_CONNECTION_STRING=${answers.connectionString}\n`
  }

  envContent += `\n# RabbitMQ configuration\n`
  envContent += `RABBITMQ_URL=${answers.rabbitmqUrl}\n`
  envContent += `REQUEST_QUEUE=${answers.requestQueue}\n`
  envContent += `RESPONSE_QUEUE=${answers.responseQueue}\n`

  // Write the .env file
  try {
    await fs.writeFile(envPath, envContent)
    console.log(`\n✅ Configuration saved to ${envPath}`)

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
