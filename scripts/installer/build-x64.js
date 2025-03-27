// scripts/installer/build-x64.js
const { execSync } = require('child_process')
const path = require('path')

console.log('Building installer for x64 architecture...')

try {
  // Force x64 architecture for the build
  execSync('electron-builder --win nsis --x64 --config.forceCodeSigning=false', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../..')
  })

  console.log('Build completed successfully!')
} catch (error) {
  console.error('Build failed:', error.message)
  process.exit(1)
}
