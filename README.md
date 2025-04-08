# Avoqado POS Service Installation Guide

## Version 1.0.0

### Pre-requisites
- Windows 8 or higher
- Node.js 16.x or higher
- Administrative privileges on the target machine
- Microsoft SQL Server (2016 or higher)

### Installation Steps
1. Extract this package to a directory on the target machine
2. Open a Command Prompt or PowerShell window as Administrator
3. Navigate to the extracted directory
4. Run the setup script to configure database and service settings:
   ```
   npm run setup
   ```
5. Install the database schema:
   ```
   npm run install-db
   ```
   or run the batch file:
   ```
   install-db.bat
   ```
6. Install the Windows service:
   ```
   npm run install-service
   ```
   or run the batch file:
   ```
   install.bat
   ```

### Database Installation
The database installer will automatically run the following SQL scripts in order:
1. `1.Clean_tables_triggers_procedures.sql` - Removes existing tables, triggers, and procedures
2. `2.Create_tables_and_procedures.sql` - Creates the required tables and procedures
3. `3.[soft10]_create_triggers_and_index.sql` - Creates triggers and indexes

**Warning:** The first script removes existing objects, so make sure you have a backup of your database if needed.

### Uninstallation
To uninstall the service, run:
```
npm run uninstall-service
```
or:
```
node uninstall-service.js
```

### Troubleshooting
- Check Windows Event Viewer for service-related errors
- Review log files in the 'logs' directory
- Ensure the database and RabbitMQ connections are valid
- For database connection issues, use SQL Server Configuration Manager to verify SQL Server is running
