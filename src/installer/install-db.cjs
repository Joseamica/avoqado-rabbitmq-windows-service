const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const readline = require('readline');

// Try to load dotenv if available
let dotenv;
try {
  dotenv = require('dotenv');
  dotenv.config();
  console.log('Loaded environment variables from .env file');
} catch (err) {
  console.warn('dotenv not available, continuing without .env file support');
}

// Root path and SQL script path
const rootPath = path.join(__dirname, '..', '..');
const configPath = path.join(rootPath, '.env');
const sqlScriptPath = path.join(rootPath, 'scripts', 'sql');

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// SQL scripts to run in sequence
const sqlScripts = [
  {
    name: '1.Clean_tables_triggers_procedures.sql',
    description: 'Cleaning tables, triggers, and procedures'
  },
  {
    name: '2.Create_tables_and_procedures.sql',
    description: 'Creating tables and procedures'
  },
  {
    name: '3.[soft10]_create_triggers_and_index.sql',
    description: 'Creating triggers and indexes'
  }
];

// Function to find the configuration file in multiple possible locations
function findConfigFile() {
  const possiblePaths = [
    configPath,
    path.join(__dirname, '..', '..', '.env')
  ].filter(Boolean);

  console.log('Searching for configuration file in these locations:');
  possiblePaths.forEach((p) => console.log(`- ${p}`));

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`✅ Found configuration file at: ${p}`);
        return p;
      }
    } catch (err) {
      // Ignore errors and continue searching
    }
  }

  console.error('❌ Configuration file not found in any location');
  return null;
}

// Create database connection configuration
function createDbConfig() {
  // If a full connection string is provided, parse it
  if (process.env.DB_CONNECTION_STRING) {
    const connStr = process.env.DB_CONNECTION_STRING;
    const config = {};

    connStr.split(';').forEach((pair) => {
      const [key, value] = pair.split('=');
      if (key && value) {
        const k = key.trim().toLowerCase();
        if (k === 'server') config.server = value.trim();
        else if (k === 'user id' || k === 'uid') config.user = value.trim();
        else if (k === 'password' || k === 'pwd') config.password = value.trim();
        else if (k === 'database' || k === 'initial catalog') config.database = value.trim();
        else if (k === 'instance name') config.instanceName = value.trim();
      }
    });

    return config;
  }

  // Check if server has format "server\instance"
  let server = process.env.DB_SERVER || 'localhost';
  let instanceName = process.env.DB_INSTANCE || undefined;

  if (server.includes('\\')) {
    const parts = server.split('\\');
    server = parts[0];
    instanceName = parts[1];
    console.log(`Detected server with instance: ${server}\\${instanceName}`);
  }

  // Build from individual parts
  return {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'avo',
    server: server,
    instanceName: instanceName,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 30000,
      requestTimeout: 30000
    }
  };
}

// Execute SQL file using sqlcmd or PowerShell
async function executeSqlFile(dbConfig, scriptPath) {
  const filename = path.basename(scriptPath);
  console.log(`\nExecuting: ${filename}`);

  // Check if sqlcmd is available
  let sqlcmdAvailable = false;
  try {
    execSync('sqlcmd -?', { stdio: 'ignore' });
    sqlcmdAvailable = true;
  } catch (err) {
    console.log('SQLCMD not available, will use PowerShell');
  }

  if (sqlcmdAvailable) {
    try {
      // Execute with SQLCMD
      const sqlcmdArgs = `-S "${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}" -d "${dbConfig.database}" -U "${dbConfig.user}" -P "${dbConfig.password || ''}" -I -i "${scriptPath}"`;
      execSync(`sqlcmd ${sqlcmdArgs}`, { stdio: 'inherit' });
      console.log(`✅ Successfully executed ${filename}`);
      return true;
    } catch (error) {
      console.error(`❌ Error executing SQL file ${filename} with sqlcmd:`, error.message);
      return false;
    }
  } else {
    try {
      // Read the SQL file
      const sqlContent = fs.readFileSync(scriptPath, 'utf8');

      // Split by GO to handle batches
      const sqlBatches = sqlContent.split(/\nGO\s*$/im);

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
`;
      const psScriptPath = path.join(os.tmpdir(), `avoqado_execute_${filename.replace('.sql', '')}.ps1`);
      fs.writeFileSync(psScriptPath, psScript);

      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' });
        console.log(`✅ Successfully executed ${filename} with PowerShell`);
        
        // Cleanup
        try {
          fs.unlinkSync(psScriptPath);
        } catch (err) {
          // Ignore cleanup errors
        }
        
        return true;
      } catch (error) {
        console.error(`❌ Error executing SQL file ${filename} with PowerShell:`, error.message);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error processing SQL file ${filename}:`, error.message);
      return false;
    }
  }
}

// Main function
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║             Avoqado POS Database Installer               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Load config
  const actualConfigPath = findConfigFile();
  if (actualConfigPath) {
    if (dotenv) {
      try {
        dotenv.config({ path: actualConfigPath });
        console.log(`Loaded configuration from: ${actualConfigPath}`);
      } catch (err) {
        console.warn(`Error loading config: ${err.message}`);
      }
    }
  } else {
    console.error('No configuration file found. Please run the setup step first.');
    process.exit(1);
  }

  // Get database configuration
  const dbConfig = createDbConfig();
  console.log(`\nDatabase configuration:`);
  console.log(`- Server: ${dbConfig.server}${dbConfig.instanceName ? '\\' + dbConfig.instanceName : ''}`);
  console.log(`- Database: ${dbConfig.database}`);
  console.log(`- User: ${dbConfig.user}`);

  // Confirm with user
  console.log('\n⚠️ WARNING: This will run SQL scripts that will modify the database structure.');
  console.log('⚠️ It includes deleting tables, triggers, and procedures if they already exist.');
  
  rl.question('Do you want to continue? (y/n): ', async (answer) => {
    if (answer.toLowerCase() !== 'y') {
      console.log('Operation cancelled by user.');
      rl.close();
      return;
    }

    console.log('\nProceeding with database script installation...');
    
    let successCount = 0;
    
    // Execute SQL scripts in sequence
    for (const script of sqlScripts) {
      const scriptPath = path.join(sqlScriptPath, script.name);
      
      // Check if file exists
      if (!fs.existsSync(scriptPath)) {
        console.error(`❌ SQL file not found: ${script.name}`);
        continue;
      }
      
      console.log(`\nRunning step: ${script.description}`);
      const success = await executeSqlFile(dbConfig, scriptPath);
      if (success) successCount++;
    }
    
    // Summary
    console.log(`\n${successCount} of ${sqlScripts.length} SQL scripts executed successfully`);
    
    if (successCount === sqlScripts.length) {
      console.log('\n✅ Database installation completed successfully');
    } else {
      console.log(`\n⚠️ Database installation completed with ${sqlScripts.length - successCount} errors.`);
      console.log('Some tables or objects may not have been created correctly.');
    }
    
    rl.close();
  });
}

// Run the main function
main().catch((error) => {
  console.error('\n❌ Error during database installation:', error.message);
  process.exit(1);
}); 