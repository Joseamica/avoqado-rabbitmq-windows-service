// src/installer/install-service.cjs
const { Service } = require('node-windows');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const dotenv = require('dotenv');

// Project root directory (2 levels up from this file)
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Load template .env for defaults
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

// Get package information
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

// Service configuration object
const serviceConfig = {
  venueId: process.env.VENUE_ID || 'default_venue',
  dbUser: process.env.DB_USER || 'sa',
  dbPassword: process.env.DB_PASSWORD || 'National09',
  dbServer: process.env.DB_SERVER || 'localhost',
  dbDatabase: process.env.DB_DATABASE || 'avo',
  dbInstance: process.env.DB_INSTANCE || 'NATIONALSOFT',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqps://wkdeleat:E-37pD2qqZfeEzOoZ1VwnREE2oUqKnr8@moose.rmq.cloudamqp.com/wkdeleat'
};

// Prompt for service configuration
console.log('=== Avoqado POS Service Installer ===');
console.log('Please provide the following information:');

function promptForConfig() {
  rl.question(`Venue ID [${serviceConfig.venueId}]: `, (venueId) => {
    if (venueId) serviceConfig.venueId = venueId;
    
    rl.question(`Database User [${serviceConfig.dbUser}]: `, (dbUser) => {
      if (dbUser) serviceConfig.dbUser = dbUser;
      
      rl.question(`Database Password [********]: `, (dbPassword) => {
        if (dbPassword) serviceConfig.dbPassword = dbPassword;
        
        rl.question(`Database Server [${serviceConfig.dbServer}]: `, (dbServer) => {
          if (dbServer) serviceConfig.dbServer = dbServer;
          
          rl.question(`Database Name [${serviceConfig.dbDatabase}]: `, (dbDatabase) => {
            if (dbDatabase) serviceConfig.dbDatabase = dbDatabase;
            
            rl.question(`Database Instance [${serviceConfig.dbInstance}]: `, (dbInstance) => {
              if (dbInstance) serviceConfig.dbInstance = dbInstance;
              
              rl.question(`RabbitMQ URL [${serviceConfig.rabbitmqUrl}]: `, (rabbitmqUrl) => {
                if (rabbitmqUrl) serviceConfig.rabbitmqUrl = rabbitmqUrl;
                
                // Configuration completed, generate .env file
                generateEnvFile();
              });
            });
          });
        });
      });
    });
  });
}

// Generate .env file from config
function generateEnvFile() {
  console.log('\nGenerating configuration file...');
  
  const envContent = `# Avoqado POS Service Configuration
# Generated by setup utility on ${new Date().toISOString()}

# Venue configuration
VENUE_ID=${serviceConfig.venueId}

# Database configuration
DB_USER=${serviceConfig.dbUser}
DB_PASSWORD=${serviceConfig.dbPassword}
DB_SERVER=${serviceConfig.dbServer}
DB_DATABASE=${serviceConfig.dbDatabase}
DB_INSTANCE=${serviceConfig.dbInstance}

# RabbitMQ configuration
RABBITMQ_URL=amqps://wkdeleat:E-37pD2qqZfeEzOoZ1VwnREE2oUqKnr8@moose.rmq.cloudamqp.com/wkdeleat
REQUEST_QUEUE=operations_queue
RESPONSE_QUEUE=responses_queue
`;
  
  fs.writeFileSync(path.join(PROJECT_ROOT, '.env'), envContent);
  console.log('Configuration saved to .env file');
  
  // Install the service
  installService();
}

// Install Windows service
function installService() {
  console.log('\nInstalling Windows service...');
  
  // Create logs directory if it doesn't exist
  const logsDir = path.join(PROJECT_ROOT, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Normalize service name (remove spaces and special characters)
  const serviceName = `AvoqadoPOSService_${serviceConfig.venueId}`
    .replace(/[^a-zA-Z0-9_]/g, '');
  
  // Path to the main application script
  const mainScriptPath = path.join(PROJECT_ROOT, 'src', 'index.js');
  
  // Get the path to node executable
  const nodePath = process.execPath;
  
  console.log('Service Configuration:');
  console.log('- Service Name:', serviceName);
  console.log('- Main Script:', mainScriptPath);
  console.log('- Node Path:', nodePath);
  console.log('- Working Directory:', PROJECT_ROOT);
  
  // Create a new service object
  const svc = new Service({
    name: serviceName,
    description: `Avoqado POS Integration Service for ${serviceConfig.venueId}`,
    script: mainScriptPath,
    execPath: nodePath,
    workingDirectory: PROJECT_ROOT,
    allowServiceLogon: true,
    
    // Log settings
    logOnAs: {
      account: 'LocalSystem',
      password: '',
      domain: ''
    },
    
    // Environment variables
    env: [
      {
        name: 'NODE_ENV',
        value: 'production'
      },
      {
        name: 'SERVICE_VERSION',
        value: packageJson.version || '1.0.0'
      },
      {
        name: 'VENUE_ID',
        value: serviceConfig.venueId
      }
    ]
  });
  
  // Listen for installation events
  svc.on('install', () => {
    console.log(`Service "${serviceName}" installed successfully`);
    svc.start();
  });
  
  svc.on('alreadyinstalled', () => {
    console.log(`Service "${serviceName}" is already installed`);
    console.log('Attempting to start the service...');
    svc.start();
  });
  
  svc.on('start', () => {
    console.log(`Service "${serviceName}" started successfully`);
    rl.close();
  });
  
  svc.on('invalidinstallation', (error) => {
    console.error('Invalid installation. The service may not be properly installed.');
    console.error('Error details:', error);
    rl.close();
  });
  
  svc.on('error', (err) => {
    console.error('Service installation error:', err);
    rl.close();
  });
  
  // Attempt to install the service
  svc.install();
}

// Start the configuration and installation process
promptForConfig();