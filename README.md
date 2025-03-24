# Avoqado RabbitMQ Windows Server

A Windows service that processes RabbitMQ messages from the cloud backend and performs operations on the local SQL Server database.

## Features

- Connects to RabbitMQ message broker
- Processes operations for shifts, waiters, products, and payments
- Runs as a native Windows service
- Provides robust error handling and logging

## Prerequisites

- Node.js 18 or higher
- Windows OS
- RabbitMQ server
- MS SQL Server

## Installation

1. Clone the repository

   ```
   git clone https://your-repository-url.git
   cd avoqado-rabbit-windows-server
   ```

2. Install dependencies

   ```
   npm install
   ```

3. Create `.env` file with required configuration (see `.env.example`)

   ```
   cp .env.example .env
   ```

4. Edit the `.env` file with your specific configuration

5. Install as Windows service
   ```
   npm run install-service
   ```

## Development

1. Start the service in development mode

   ```
   npm run dev
   ```

2. Lint code

   ```
   npm run lint
   ```

3. Fix linting issues
   ```
   npm run lint:fix
   ```

## Project Structure

```
avoqado-rabbit-windows-server/
┣ src/                    # Source code
┃ ┣ config/               # Configuration files
┃ ┣ services/             # Service implementations
┃ ┣ utils/                # Utility functions
┃ ┗ index.js              # Main entry point
┣ scripts/                # Installation scripts
┣ logs/                   # Log files directory
┣ .env                    # Environment variables
┗ package.json            # Node.js package configuration
```

## Troubleshooting

- Check the log files in the `logs` directory
- Windows Event Viewer will also contain service errors
- If service fails to start, check the connection settings in `.env`

## Uninstallation

To uninstall the Windows service:

```
npm run uninstall-service
```

## License

[Your License Here]
