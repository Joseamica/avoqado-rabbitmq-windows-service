// Script to download a default icon for the installer
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path where the icon will be saved
const iconPath = path.join(__dirname, 'assets', 'icon.ico')

// Create the assets directory if it doesn't exist
const assetsDir = path.join(__dirname, 'assets')
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true })
}

// Check if icon already exists
if (fs.existsSync(iconPath)) {
  console.log(`Icon already exists at ${iconPath}`)
  process.exit(0)
}

// URL for a simple icon (this is a placeholder URL - replace with a real icon URL)
// In a real scenario, you should host your own icon file or use an icon conversion service
const iconUrl = 'https://firebasestorage.googleapis.com/v0/b/avoqado-d0a24.appspot.com/o/Isotipo.png?alt=media&token=70365422-c1ea-4c6e-a27d-86cf7b26cd00'

console.log('Downloading default icon...')

// Download the icon
https
  .get(iconUrl, (response) => {
    if (response.statusCode !== 200) {
      console.error(`Failed to download icon: ${response.statusCode} ${response.statusMessage}`)
      process.exit(1)
    }

    const file = fs.createWriteStream(iconPath)
    response.pipe(file)

    file.on('finish', () => {
      file.close()
      console.log(`Icon downloaded and saved to ${iconPath}`)
    })
  })
  .on('error', (err) => {
    console.error(`Error downloading icon: ${err.message}`)
    process.exit(1)
  })
