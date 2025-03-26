#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Now we need to go up TWO levels to get to the project root
const rootPath = path.join(__dirname, '..', '..')
const distPath = path.join(rootPath, 'scripts', 'dist')

async function build() {
  console.log('Building Avoqado Service Installer...')

  try {
    // Create dist directory if it doesn't exist
    await fs.mkdir(distPath, { recursive: true })

    // Clean previous build
    console.log('Cleaning previous build...')
    try {
      const files = await fs.readdir(distPath)
      for (const file of files) {
        await fs.rm(path.join(distPath, file), { force: true, recursive: true })
      }
    } catch (error) {
      // If directory doesn't exist or is empty, continue
      console.log('No previous build to clean.')
    }

    // Run pkg to build the executable
    console.log('Building executable with pkg...')
    // Explicitly specify the entry point, output path, and target
    const wrapperPath = path.join(rootPath, 'scripts', 'installer', 'wrapper.js')
    const outputPath = path.join(distPath, 'avoqado-communication-service.exe')

    // Add debug flags to see more information during execution
    execSync(`npx pkg "${wrapperPath}" --target node18-win-x64 --output "${outputPath}" --debug`, {
      stdio: 'inherit',
      cwd: rootPath
    })

    // Copy SQL scripts and needed files
    console.log('Copying SQL scripts...')
    const sqlSourceDir = path.join(rootPath, 'scripts', 'sql')
    const sqlTargetDir = path.join(distPath, 'scripts', 'sql')

    await fs.mkdir(sqlTargetDir, { recursive: true })

    const sqlFiles = await fs.readdir(sqlSourceDir)
    for (const file of sqlFiles) {
      await fs.copyFile(path.join(sqlSourceDir, file), path.join(sqlTargetDir, file))
    }

    // Create .env.example in the dist folder
    console.log('Creating .env.example in distribution folder...')
    await fs.copyFile(path.join(rootPath, '.env.example'), path.join(distPath, '.env.example'))

    // Copy other module files that might be needed
    console.log('Copying installer scripts for dynamic imports...')
    const installerSourceDir = path.join(rootPath, 'scripts', 'installer')
    const installerTargetDir = path.join(distPath, 'scripts', 'installer')

    await fs.mkdir(installerTargetDir, { recursive: true })

    // Copy setup.js, setup-db.js, install-service.js, and uninstall-service.js
    const installerFiles = ['setup.cjs', 'setup-db.cjs', 'install-service.cjs', 'uninstall-service.cjs']
    for (const file of installerFiles) {
      await fs.copyFile(path.join(installerSourceDir, file), path.join(installerTargetDir, file))
    }

    // Create a batch file for easier running and debugging
    console.log('Creating a batch file for easier execution...')
    const batchContent = `@echo off
echo Starting Avoqado Service Installer...
avoqado-communication-service.exe
echo.
echo Press any key to close this window.
pause > nul`

    await fs.writeFile(path.join(distPath, 'run-service.bat'), batchContent)

    console.log('✅ Build completed successfully!')
    console.log(`Executable can be found at: ${path.join(distPath, 'avoqado-communication-service.exe')}`)
    console.log(`For easier debugging, run: ${path.join(distPath, 'run-service.bat')}`)
  } catch (error) {
    console.error('❌ Build failed:', error.message)
    process.exit(1)
  }
}

build()
