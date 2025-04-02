// src/installer/package.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Get package version from package.json
const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const { version } = packageJson;

// Create a dist directory if it doesn't exist
const distDir = path.join(PROJECT_ROOT, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

console.log('Building Avoqado POS Service package...');

// Install production dependencies
console.log('Installing production dependencies...');
try {
  execSync('npm ci --production', { 
    stdio: 'inherit',
    cwd: PROJECT_ROOT 
  });
} catch (error) {
  console.error('Failed to install dependencies:', error.message);
  process.exit(1);
}

// Files to include in the package
const filesToInclude = [
  'src',
  'node_modules',
  'package.json',
  'install.bat',
  'uninstall.bat',
  'icon-original.ico',
  'README.md'
];

// Create a sanitized .env.template
const templateEnvPath = path.join(PROJECT_ROOT, '.env.template');
const currentEnvPath = path.join(PROJECT_ROOT, '.env');

if (fs.existsSync(currentEnvPath)) {
  const envContent = fs.readFileSync(currentEnvPath, 'utf8');
  
  const templateContent = envContent
    .replace(/DB_PASSWORD=.*/g, 'DB_PASSWORD=')
    .replace(/RABBITMQ_URL=.*/g, 'RABBITMQ_URL=')
    .replace(/VENUE_ID=.*/g, 'VENUE_ID=venue_name');
  
  fs.writeFileSync(templateEnvPath, templateContent);
  console.log('.env.template created with sanitized values');
  
  // Add it to the files to include
  filesToInclude.push('.env.template');
}

// Create a ZIP archive
const outputPath = path.join(distDir, `avoqado-pos-service-v${version}.zip`);
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
  console.log(`Package created successfully: ${outputPath}`);
  console.log(`Total size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
  
  // Cleanup
  if (fs.existsSync(templateEnvPath)) {
    fs.unlinkSync(templateEnvPath);
  }
});

archive.on('error', (err) => {
  console.error('Error creating archive:', err);
  process.exit(1);
});

archive.pipe(output);

// Add each file/directory to the archive
for (const file of filesToInclude) {
  const filePath = path.join(PROJECT_ROOT, file);
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      archive.directory(filePath, file);
    } else {
      archive.file(filePath, { name: file });
    }
  } else {
    console.warn(`Warning: File or directory not found: ${file}`);
  }
}

// Create empty logs directory
archive.append(null, { name: 'logs/' });

// Finalize the archive
console.log('Creating package...');
archive.finalize();