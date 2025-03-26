import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

// Get the current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..', '..')

// Function to execute shell commands
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${command}`)

    exec(command, { cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`)
        return reject(error)
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`)
      }
      console.log(`stdout: ${stdout}`)
      resolve(stdout)
    })
  })
}

// Main build function
async function buildInstallerExecutable() {
  try {
    console.log('Starting build process for Avoqado POS Service Installer...')

    // Make sure the icon exists, use a default if not
    const iconPath = path.join(__dirname, 'assets', 'icon.ico')
    if (!fs.existsSync(iconPath)) {
      console.warn(`Icon not found at ${iconPath}. Default icon will be used.`)

      // Create assets directory if it doesn't exist
      const assetsDir = path.join(__dirname, 'assets')
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true })
      }
    }

    // Run electron-builder
    console.log('Running electron-builder...')
    await executeCommand('npm run package')

    console.log('Build completed successfully!')
    console.log(`Installer can be found in: ${path.join(rootDir, 'dist', 'electron-build')}`)
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

// Run the build process
buildInstallerExecutable()
