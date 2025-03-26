// Script to ensure the installer uses the correct icon
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Icon paths
const iconPath = path.join(__dirname, 'assets', 'icon.ico')
const buildDir = path.join(__dirname, '..', '..', 'build')

// Create build directory if it doesn't exist
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true })
}

// Copy icon to build directory where electron-builder looks for it
fs.copyFileSync(iconPath, path.join(buildDir, 'icon.ico'))
console.log(`Copied icon to ${path.join(buildDir, 'icon.ico')} for installer`)
