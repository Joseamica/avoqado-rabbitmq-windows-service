# Avoqado POS Service Installation Guide

## Version 1.0.0

### Pre-requisites
- Windows 8 or higher
- Node.js 16.x or higher
- Administrative privileges on the target machine

### Installation Steps
1. Extract this package to a directory on the target machine
2. Open a Command Prompt or PowerShell window as Administrator
3. Navigate to the extracted directory
4. Run the installation script:
   ```
   node install-service.js
   ```
5. Follow the prompts to configure the service

### Uninstallation
To uninstall the service, run:
```
node uninstall-service.js
```

### Troubleshooting
- Check Windows Event Viewer for service-related errors
- Review log files in the 'logs' directory
- Ensure the database and RabbitMQ connections are valid
