// Script to download a default icon for the installer ONLY if it doesn't exist
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

// Check if icon already exists - if it does, no need to download
if (fs.existsSync(iconPath)) {
  console.log(`Icon already exists at ${iconPath}, skipping download`)
  process.exit(0) // Exit successfully - no need to download
}

// URL for a simple icon (this is a placeholder URL - replace with a real icon URL)
// In a real scenario, you should host your own icon file or use an icon conversion service
const iconUrl = 'https://firebasestorage.googleapis.com/v0/b/avoqado-d0a24.appspot.com/o/Isotipo.ico?alt=media&token=be1f1ad4-80d3-468f-942b-95a31840a2b1'
// const iconUrl = 'https://firebasestorage.googleapis.com/v0/b/avoqado-d0a24.appspot.com/o/192x192.png?alt=media&token=ef63a22d-da83-4b58-8792-8340946b9483'

console.log('Icon not found. Downloading default icon...')

// Download the icon
https
  .get(iconUrl, (response) => {
    if (response.statusCode !== 200) {
      console.error(`Failed to download icon: ${response.statusCode} ${response.statusMessage}`)
      console.warn('Using a blank icon placeholder. Please manually add an icon.ico file to scripts/installer/assets/ for best results.')

      // Create an empty file so the build doesn't fail
      fs.writeFileSync(iconPath, Buffer.alloc(0))
      process.exit(0) // Exit successfully even though download failed
    }

    const file = fs.createWriteStream(iconPath)
    response.pipe(file)

    file.on('finish', () => {
      file.close()
      console.log(`Icon downloaded and saved to ${iconPath}`)
    })

    file.on('error', (err) => {
      console.error(`Error writing icon file: ${err.message}`)
      console.warn('Using a blank icon placeholder. Please manually add an icon.ico file to scripts/installer/assets/ for best results.')

      // Create an empty file so the build doesn't fail
      try {
        fs.writeFileSync(iconPath, Buffer.alloc(0))
      } catch (e) {
        // Ignore errors when trying to create placeholder
      }

      process.exit(0) // Exit successfully even though there was an error
    })
  })
  .on('error', (err) => {
    console.error(`Error downloading icon: ${err.message}`)
    console.warn('Using a blank icon placeholder. Please manually add an icon.ico file to scripts/installer/assets/ for best results.')

    // Create an empty file so the build doesn't fail
    try {
      fs.writeFileSync(iconPath, Buffer.alloc(0))
    } catch (e) {
      // Ignore errors when trying to create placeholder
    }

    process.exit(0) // Exit successfully even though there was an error
  })
