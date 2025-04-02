// installer/uninstall-service.cjs
const { Service } = require('node-windows');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

// Get venue ID
const venueId = process.env.VENUE_ID || 'default_venue';

// Normalize service name (remove spaces and special characters)
const serviceName = `AvoqadoPOSService_${venueId}`
  .replace(/[^a-zA-Z0-9_]/g, '');

console.log(`Attempting to uninstall service: ${serviceName}`);

// Create a new service object
const svc = new Service({
  name: serviceName,
  script: path.join(PROJECT_ROOT, 'src', 'index.js'),
  programArgs: []
});

// Listen for uninstallation events
svc.on('uninstall', () => {
  console.log(`Service "${serviceName}" uninstalled successfully`);
  process.exit(0);
});

svc.on('error', (err) => {
  console.error('Service uninstallation error:', err);
  process.exit(1);
});

// Check if the daemon folder exists and remove it
const daemonDir = path.join(PROJECT_ROOT, 'daemon');
if (fs.existsSync(daemonDir)) {
  try {
    fs.rmSync(daemonDir, { recursive: true, force: true });
    console.log(`Removed daemon directory: ${daemonDir}`);
  } catch (err) {
    console.error(`Error removing daemon directory: ${err.message}`);
  }
}

// Attempt to uninstall the service
console.log(`Uninstalling service "${serviceName}"...`);
svc.uninstall();