// preload.js - CommonJS version
const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    // whitelist channels
    const validChannels = ['run-setup', 'run-db-setup', 'install-service', 'uninstall-service', 'save-config', 'fetch-databases']

    if (validChannels.includes(channel)) {
      console.log(`Sending message on channel: ${channel}`, data)
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel, func) => {
    const validChannels = ['script-output', 'script-error', 'script-complete', 'database-list']

    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      console.log(`Setting up listener for channel: ${channel}`)
      ipcRenderer.on(channel, (event, ...args) => func(...args))
    }
  }
})

// Log when preload script has completed
console.log('Preload script has loaded successfully')
