# Avoqado RabbitMQ Windows Service

A Windows service that synchronizes data between SQL Server and Avoqado Cloud via RabbitMQ messaging. This service handles bidirectional communication, tracking database changes and processing operations from the cloud.

## Features

- Real-time database change tracking
- Bidirectional synchronization with Avoqado Cloud
- Windows service integration with auto-restart capabilities
- Robust error handling and logging

## Prerequisites

- Windows 10/11 or Windows Server 2016+
- Node.js 16+ ([Download](https://nodejs.org/))
- Microsoft SQL Server 2016+ with Change Tracking enabled
- Administrative privileges (for service installation)

## Installation

### Automatic Installation (Recommended)

1. Download the latest installer package
2. Run the setup application as Administrator
3. Follow the on-screen instructions to configure the service

### Manual Installation

1. Clone this repository or extract the package:

   ```
   git clone https://github.com/avoqado/avoqado-rabbitmq-windows-service.git
   cd avoqado-rabbitmq-windows-service
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Create a `.env` file based on the example:

   ```
   cp .env.example .env
   ```

4. Configure your environment variables (see Configuration section)

5. Install the Windows service:

   ```
   node scripts/installer/install-service.cjs
   ```

## Configuration

Create a `.env` file in the project root with the following variables:

```
# Venue configuration
VENUE_ID=your_venue_id

# Database configuration
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_SERVER=your_db_server
DB_DATABASE=your_db_name
DB_INSTANCE=your_db_instance  # Optional

# RabbitMQ configuration
RABBITMQ_URL=your_rabbitmq_url
REQUEST_QUEUE=operations_queue
RESPONSE_QUEUE=operations_queue
```

## Usage

### Windows Service Management

Once installed, the service can be managed through Windows Services:

1. Open Services (services.msc)
2. Find "AvoqadoRabbitMQService" in the list
3. Use the Start, Stop, or Restart commands as needed

### Command Line Management

You can also manage the service using the command line:

```
# Start the service
net start AvoqadoRabbitMQService

# Stop the service
net stop AvoqadoRabbitMQService

# Check status (PowerShell)
Get-Service AvoqadoRabbitMQService
```

### Uninstalling

To remove the service:

```
node scripts/installer/uninstall-service.cjs
```

## Project Structure

```
avoqado-rabbitmq-windows-service/
├── scripts/                  # Utility scripts
│   ├── installer/            # Installation scripts
│   └── sql/                  # SQL setup scripts
├── src/                      # Source code
│   ├── config/               # Configuration files
│   ├── services/             # Core service modules
│   │   ├── database/         # Database operations
│   │   ├── handlers/         # Message handlers
│   │   ├── poller/           # Database polling
│   │   └── rabbitmq/         # RabbitMQ integration
│   ├── utils/                # Utility functions
│   └── index.js              # Main application entry
└── daemon/                   # Windows service files
```

## Troubleshooting

### Service Won't Start

Check the log files located in `src/daemon/` directory:

- `avoqadorabbitmqservice.out.log` - Standard output
- `avoqadorabbitmqservice.err.log` - Error output
- `avoqadorabbitmqservice.wrapper.log` - Service wrapper logs

Common issues:

1. Database connection errors - Verify SQL Server credentials and permissions
2. RabbitMQ connection issues - Check network connectivity and credentials
3. Missing or incorrect configuration - Verify your `.env` file settings

### Database Synchronization Issues

1. Ensure SQL Server Change Tracking is enabled
2. Verify the service account has appropriate permissions
3. Check the output logs for specific error messages

## Development

To run the service in development mode:

```
npm start
```

For debugging:

```
npm run debug
```

## License

This software is proprietary and confidential. Unauthorized copying, transferring or reproduction of this software, via any medium is strictly prohibited.

© 2023 Avoqado. All rights reserved.
