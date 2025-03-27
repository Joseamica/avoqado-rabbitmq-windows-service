// scripts/installer/create-shortcut.js
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

// Determine the paths
const appPath = process.execPath
const appName = path.basename(appPath, path.extname(appPath))

// Create a .bat file shortcut for the desktop that launches the app
const userProfile = process.env.USERPROFILE
const desktopPath = path.join(userProfile, 'Desktop')

// Create a batch file that launches the app
const batchContent = `@echo off
start "" "${appPath}"
`

// Path for the batch file
const batchPath = path.join(desktopPath, `${appName}.bat`)

// Create the batch file
fs.writeFileSync(batchPath, batchContent)

console.log(`Created shortcut at: ${batchPath}`)
