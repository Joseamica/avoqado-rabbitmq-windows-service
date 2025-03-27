// ensure-dependencies.js
// This helper script ensures all required dependencies are installed locally for the setup-db.cjs script
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// List of dependencies used by setup-db.cjs
const requiredDependencies = ['debug', 'ms', 'mssql', 'dotenv', 'tedious', 'generic-pool', 'tarn']

// Check if running from an Electron packaged app
const isPackaged = process.resourcesPath && process.resourcesPath.includes('app.asar')

// Determine the target directory for dependencies
let targetDir
if (isPackaged) {
  // When running from packaged app, use a directory next to the executable
  targetDir = path.join(path.dirname(process.execPath), 'node_modules')
} else {
  // In development, use the project's node_modules
  targetDir = path.join(__dirname, '..', '..', 'node_modules')
}

console.log(`Ensuring dependencies exist in: ${targetDir}`)

// Create node_modules directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
  console.log('Creating node_modules directory')
  fs.mkdirSync(targetDir, { recursive: true })
}

// Check for each dependency
let needsInstall = false
const missingDeps = []

for (const dep of requiredDependencies) {
  const depPath = path.join(targetDir, dep)
  if (!fs.existsSync(depPath)) {
    console.log(`Dependency missing: ${dep}`)
    needsInstall = true
    missingDeps.push(dep)
  }
}

// Install missing dependencies if needed
if (needsInstall) {
  console.log(`Installing missing dependencies: ${missingDeps.join(', ')}`)

  // Create a temporary package.json if it doesn't exist
  const packageJsonPath = path.join(targetDir, '..', 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    console.log('Creating temporary package.json')
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: 'temp-dependencies',
        version: '1.0.0',
        private: true
      })
    )
  }

  try {
    // Install the missing dependencies locally
    const installCmd = `npm install --no-save ${missingDeps.join(' ')}`
    console.log(`Running: ${installCmd}`)
    execSync(installCmd, {
      cwd: path.dirname(packageJsonPath),
      stdio: 'inherit'
    })
    console.log('Dependencies installed successfully')
  } catch (error) {
    console.error('Failed to install dependencies:', error.message)
    process.exit(1)
  }
}

console.log('All dependencies are available')
