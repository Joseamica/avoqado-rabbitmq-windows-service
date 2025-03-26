#!/usr/bin/env node

// CommonJS wrapper for the installer
const inquirer = require('inquirer')
const fs = require('fs')
const path = require('path')
const { execSync, spawn } = require('child_process')

// Use a pkg-friendly approach to get paths
let rootPath = path.dirname(process.execPath)

// For development, check if we're running in dev mode
if (rootPath.includes('node_modules')) {
  rootPath = process.cwd()
}

// Helper to run a Node.js script
function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`Running ${scriptName}...`)

    const scriptPath = path.join(rootPath, 'scripts', 'installer', `${scriptName}.js`)

    console.log(`Script path: ${scriptPath}`)

    try {
      if (!fs.existsSync(scriptPath)) {
        console.error(`Script not found: ${scriptPath}`)
        reject(new Error(`Script not found: ${scriptPath}`))
        return
      }

      const child = spawn('node', [scriptPath], {
        stdio: 'inherit',
        shell: true
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Script exited with code ${code}`))
        }
      })

      child.on('error', (err) => {
        reject(err)
      })
    } catch (error) {
      console.error(`Error running script: ${error.message}`)
      reject(error)
    }
  })
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           Avoqado POS Service Installation               ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('Welcome to the Avoqado POS Service installer.\n')
  console.log(`Current path: ${rootPath}`)

  try {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Setup service configuration', value: 'setup' },
          { name: 'Configure database (enable Change Tracking)', value: 'db-setup' },
          { name: 'Install Windows service', value: 'install' },
          { name: 'Uninstall Windows service', value: 'uninstall' },
          { name: 'Exit', value: 'exit' }
        ]
      }
    ])

    if (answers.action === 'exit') {
      console.log('Exiting installer. Thank you for using Avoqado POS Service!')
      return
    }

    switch (answers.action) {
      case 'setup':
        await runScript('setup')
        break

      case 'db-setup':
        await runScript('setup-db')
        break

      case 'install':
        await runScript('install-service')
        break

      case 'uninstall':
        await runScript('uninstall-service')
        break

      default:
        console.log('Invalid option selected.')
    }

    // After completion, ask if they want to do something else
    const continueResponse = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continueAction',
        message: 'Would you like to perform another action?',
        default: true
      }
    ])

    if (continueResponse.continueAction) {
      // Restart the main function
      await main()
    } else {
      console.log('\nThank you for using Avoqado POS Service!')
    }
  } catch (error) {
    console.error('An error occurred:', error.message)
    waitForKeypress('Press any key to continue...')
  }
}

function waitForKeypress(message) {
  console.log(message)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve) =>
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve()
    })
  )
}

// Run the main function and handle errors
main().catch(async (error) => {
  console.error('An unexpected error occurred:', error)
  await waitForKeypress('Press any key to exit...')
})
