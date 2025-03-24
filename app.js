// rabbitmq-service.js

import pkg from 'mssql'
import * as os from 'os'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { fileURLToPath } from 'url'
import amqp from 'amqplib'
import { dbConfig } from './socket.js'

// 🔹 Solución para __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const { ConnectionPool, Transaction } = pkg
const logFilePath = path.join(__dirname, 'service.log')
console.log('Ruta de logs:', logFilePath)

// RabbitMQ configuration
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672'
const REQUEST_QUEUE = 'operations_queue' // Queue for receiving requests from the cloud
const RESPONSE_QUEUE = 'responses_queue' // Queue for sending responses back to the cloud

let transaction

// Función para escribir logs
function logError(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ERROR: ${message}\n`
  console.error(logMessage)
  fs.appendFileSync(logFilePath, logMessage)

  // Guardar en Event Viewer de Windows
  exec(`eventcreate /ID 1 /L Application /T ERROR /SO "AvoqadoNodeService" /D "${message}"`, (err) => {
    if (err) console.error('Error al escribir en Event Viewer:', err)
  })
}

// Variable global para la conexión a la DB
let pool, connection, channel

// Connect to RabbitMQ
async function connectToRabbitMQ() {
  try {
    // Create connection to RabbitMQ
    connection = await amqp.connect(RABBITMQ_URL)
    channel = await connection.createChannel()

    // Ensure queues exist
    await channel.assertQueue(REQUEST_QUEUE, { durable: true })
    await channel.assertQueue(RESPONSE_QUEUE, { durable: true })

    console.log('Connected to RabbitMQ')

    // Handle connection closure
    connection.on('close', () => {
      console.log('🔄 RabbitMQ connection closed, attempting to reconnect...')
      setTimeout(connectToRabbitMQ, 5000)
    })

    // Start consuming messages
    setupConsumers()
  } catch (error) {
    logError(`❌ Error connecting to RabbitMQ: ${error.message}`)
    console.error('Failed to connect to RabbitMQ:', error)
    setTimeout(connectToRabbitMQ, 5000)
  }
}

// Send response back to cloud backend
// Send response back to cloud backend
async function sendResponse(operation, data, correlationId) {
  try {
    if (!channel) {
      throw new Error('RabbitMQ channel not available')
    }

    const message = {
      operation,
      data,
      correlationId, // Include the correlation ID from the request
      timestamp: new Date().toISOString()
    }

    await channel.sendToQueue(RESPONSE_QUEUE, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      // Adding message properties with correlationId for additional reliability
      messageProperties: {
        correlationId: correlationId
      }
    })

    console.log(`Response sent to ${operation} with correlationId: ${correlationId}`)
  } catch (error) {
    logError(`Error sending response: ${error.message}`)
    console.error('Failed to send response:', {
      operation,
      correlationId,
      error: error.message
    })
  }
}

// Set up message consumers
function setupConsumers() {
  // Ensure we have a channel
  if (!channel) {
    return logError('Cannot set up consumers: No RabbitMQ channel available')
  }

  // Configure prefetch to process one message at a time
  channel.prefetch(1)

  channel.consume(REQUEST_QUEUE, async (msg) => {
    if (!msg) return

    try {
      // Parse the message
      const content = JSON.parse(msg.content.toString())
      const correlationId = content.correlationId
      console.log('Received message:', content.operation, 'with correlationId:', correlationId)

      // Process based on operation type
      switch (content.operation) {
        case 'GET_SHIFTS':
          await handleGetShifts(content.data, correlationId)
          break
        case 'REQUEST_WAITERS':
          await handleRequestWaiters(content.data, correlationId)
          break
        case 'GET_PRODUCTOS_Y_CATEGORIAS':
          await handleGetProductosYCategorias(content.data, correlationId)
          break
        case 'PRINT_AND_PAY':
          await handlePrintAndPay(content.data, correlationId)
          break
        default:
          console.warn(`Unknown operation type: ${content.operation}`)
          // Send error response with correlationId for unknown operations
          await sendResponse(
            `${content.operation}_ERROR`,
            {
              error: `Unknown operation type: ${content.operation}`
            },
            correlationId
          )
      }

      // Acknowledge the message
      channel.ack(msg)
    } catch (error) {
      logError(`Error processing message: ${error.message}`)

      // Try to extract correlationId even in case of error
      let correlationId
      try {
        const content = JSON.parse(msg.content.toString())
        correlationId = content.correlationId

        // Send error response if we have a correlationId
        if (correlationId) {
          await sendResponse(
            'PROCESSING_ERROR',
            {
              error: error.message
            },
            correlationId
          )
        }
      } catch (parseError) {
        // Can't do much if we can't parse the message
        console.error('Error parsing message content:', parseError)
      }

      // Reject and don't requeue if it's a parsing error
      // Otherwise requeue for retry
      const requeue = error.name !== 'SyntaxError'
      channel.nack(msg, false, requeue)
    }
  })

  console.log('Message consumers set up successfully')
}

// 5) Conexión a la DB (IIFE)
;(async () => {
  try {
    pool = new ConnectionPool(dbConfig)
    await pool.connect()
    console.log('Conexión a la DB establecida.')

    // After DB connection, connect to RabbitMQ
    await connectToRabbitMQ()
  } catch (err) {
    logError(`❌ Error al conectar a la base de datos: ${err.message}`)
    console.error('Error al conectar a la DB:', err)

    // Retry logic (you might want to add a counter/limit)
    setTimeout(() => {
      console.log('🔄 Reintentando conexión a la DB en 5 segundos...')
      // Call this function again or restart process
    }, 5000)
  }
})()

// Handler functions for each operation
// These replace the Socket.IO event handlers

async function handleGetShifts(data, correlationId) {
  const hostname = os.hostname()

  try {
    transaction = new Transaction(pool)
    await transaction.begin()

    let request = transaction.request()

    // Obtener datos de la estación
    const estacionQuery = await request.input('hostname', hostname).query(`
      SELECT idestacion, seriefolio FROM estaciones WHERE idestacion = @hostname
    `)

    if (!estacionQuery.recordset.length) {
      throw new Error('Estación no encontrada.')
    }

    const { idestacion, seriefolio: serie } = estacionQuery.recordset[0]

    request = transaction.request() // Nuevo request para evitar conflictos con el anterior

    // Obtener turno activo
    const turnoQuery = await request.input('idestacion', idestacion).query(`
      SELECT TOP 1 idturno, cajero FROM turnos 
      WHERE cierre IS NULL AND apertura IS NOT NULL 
      AND idestacion = @idestacion
    `)

    await transaction.commit()

    if (!turnoQuery.recordset.length) {
      console.log(`⚠️ No hay turnos abiertos para la estación: ${idestacion}`)
      await sendResponse(
        'GET_SHIFTS_SUCCESS',
        {
          message: 'No hay turnos abiertos para esta estación.',
          turno: null
        },
        correlationId
      )
      return
    }

    console.log(`✅ Turno obtenido correctamente para la estación: ${idestacion}`)
    await sendResponse(
      'GET_SHIFTS_SUCCESS',
      {
        message: 'Se ha obtenido el turno correctamente.',
        turno: turnoQuery.recordset[0]
      },
      correlationId
    )
  } catch (error) {
    console.error('❌ Error al obtener turno:', error.message || error)

    // Si hay un error, revertir la transacción si estaba abierta
    if (transaction) {
      try {
        await transaction.rollback()
        console.log('🔄 Transacción revertida.')
      } catch (rollbackError) {
        console.error('⚠️ Error al revertir la transacción:', rollbackError)
      }
    }

    await sendResponse(
      'GET_SHIFTS_ERROR',
      {
        message: 'Error interno al obtener el turno. Intente de nuevo.'
      },
      correlationId
    )
  }
}

async function handleRequestWaiters(data, correlationId) {
  const { venueId } = data

  // Validate required parameters
  if (!venueId) {
    return await sendResponse(
      'REQUEST_WAITERS_ERROR',
      {
        function: 'requestWaiters',
        error: 'Missing venue id'
      },
      correlationId
    )
  }

  try {
    // Use direct query without transaction since this is a read operation
    const result = await pool.request().input('venueId', venueId) // Use proper SQL parameter
      .query(`
        SELECT 
          idmeserointerno, 
          idmesero, 
          nombre, 
          tipo, 
          visible, 
          perfil 
        FROM meseros
      `)

    await sendResponse(
      'RESPONSE_WAITERS',
      {
        venueId,
        data: result.recordset
      },
      correlationId
    )

    // Log only in development environment
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Sent ${result.recordset.length} waiters for venue ${venueId} with correlationId: ${correlationId}`)
    }
  } catch (error) {
    // Log error with structured information
    console.error('Error in requestWaiters handler:', {
      venueId,
      error: error.message,
      correlationId,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    })

    await sendResponse(
      'REQUEST_WAITERS_ERROR',
      {
        function: 'requestWaiters',
        venueId,
        error: error.message
      },
      correlationId
    )
  }
}

async function handleGetProductosYCategorias(data, correlationId) {
  const venueId = data.venueId || 'madre_cafecito'

  // Validate required parameters
  if (!venueId) {
    return await sendResponse(
      'GET_PRODUCTOS_Y_CATEGORIAS_ERROR',
      {
        function: 'getProductosYCategorias',
        error: 'Missing venue id'
      },
      correlationId
    )
  }

  try {
    transaction = new Transaction(pool)
    await transaction.begin()

    const request = transaction.request()

    // Step A: Validations (Mimicking SoftRestaurant's Initial Checks)
    await pool.request().batch('') // No-op query to mimic a fresh state

    const productosYCategoriasQuery = await request.query(`
    SELECT
      p.idproducto,
      p.descripcion AS nombre,
      p.idgrupo,
      g.descripcion AS categoria,
      g.clasificacion
    FROM productos p
    JOIN grupos g ON p.idgrupo = g.idgrupo;
    `)

    const productosYCategorias = productosYCategoriasQuery.recordset
    console.log(productosYCategorias)
    await transaction.commit()

    await sendResponse(
      'RECEIVE_PRODUCTOS_Y_CATEGORIAS',
      {
        venueId,
        data: productosYCategorias
      },
      correlationId
    )

    console.log('Procesado getProductosYCategorias con correlationId:', correlationId)
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr)
      }
    }

    console.error('Error en getProductosYCategorias:', error)

    await sendResponse(
      'GET_PRODUCTOS_Y_CATEGORIAS_ERROR',
      {
        venueId,
        error: error.message
      },
      correlationId
    )
  }
}

async function handlePrintAndPay(data, correlationId) {
  console.log('data', data)
  console.log('Processing print and pay with correlationId:', correlationId)

  const folio = data.folio ?? '1'
  const idFormadepago = data.idFormadepago ?? 'AVO' // Assuming payment method is always AVO
  const tipodecambio = 1.0
  const importe = data.importe ?? 65.0
  const propina = data.propina ?? 0.0
  const referencia = data.referencia ?? ''
  const venueId = data.venueId ?? 'madre_cafecito' // Assuming venue ID is always madre_cafecito

  let transaction
  try {
    transaction = new Transaction(pool)
    await transaction.begin()

    let request = transaction.request()
    // 🔎 1. VALIDACIONES INICIALES
    const cuentaQuery = await request.input('folio', folio).query(`
          SELECT impreso, pagado FROM tempcheques WHERE folio = @folio
        `)

    if (!cuentaQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: `La cuenta con folio ${folio} no fue encontrada.`
        },
        correlationId
      )
      throw new Error('Cuenta no encontrada.')
    }

    const { impreso, pagado } = cuentaQuery.recordset[0]

    if (pagado) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'La cuenta ya esta pagada.'
        },
        correlationId
      )
      throw new Error('Cuenta ya está pagada.')
    }

    if (impreso) {
      console.log('Cuenta ya impresa, saltando impresión y yendo directo al pago.')
      await transaction.commit() // Cerrar la transacción antes de ir a pago

      await sendResponse(
        'PRINT_ERROR',
        {
          folio,
          message: 'Impresion ya se ha realizado.'
        },
        correlationId
      )
      return await processPayment(folio, idFormadepago, importe, propina, venueId, referencia, correlationId)
    }

    console.log('Imprimiento cuenta...')
    // ---------------------------------------------
    // (A) OBTENER INFO DE LA CUENTA PARA "IMPRIMIR"
    // ---------------------------------------------
    // 1.1 Verificamos que la cuenta exista
    const descuentoYPropinaQuery = await pool.request().query(`SELECT subtotal,idcliente,impresiones,descuento,descuentoimporte,propinaincluida FROM tempcheques WHERE folio=${folio}`)
    const descuentoimporte = descuentoYPropinaQuery.recordset[0].descuentoimporte
    console.log(descuentoimporte)
    await pool.request().query(`update tempcheques set descuentoimporte=${descuentoimporte} where folio=${folio} `)
    const propinaincluida = descuentoYPropinaQuery.recordset[0].propinaincluida
    console.log(propinaincluida)
    await pool.request().query(`update tempcheques set propinaincluida=${propinaincluida} where folio=${folio} `)

    const ultimoFolioQuery = await pool.request().query(`SELECT ultimofolio FROM folios WITH (TABLOCKX)  WHERE serie='A'`)
    const ultimoFolio = ultimoFolioQuery.recordset[0].ultimofolio
    console.log(ultimoFolio)
    await pool
      .request()
      .query(
        `UPDATE tempcheques WITH(TABLOCK) SET impreso=1,numcheque=${ultimoFolio},cierre=GETDATE(),impresiones=impresiones+1,seriefolio='A',cambiorepartidor=0.000000,campoadicional1='000000000100000',codigo_unico_af='',domicilioprogramado=0,autorizacionfolio='' WHERE folio=${folio}`
      )
    await pool.request().query(`UPDATE folios WITH(TABLOCK) SET ultimofolio=${ultimoFolio} WHERE serie='A'`)
    await pool.request().query(`UPDATE cuentas set imprimir = 1, procesado = 1 where foliocuenta = ${folio}`)
    const generateUniqueCode = () => {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let result = ''
      for (let i = 0; i < 9; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length))
      }
      return result
    }

    const uniqueCode = generateUniqueCode()
    console.log(uniqueCode)
    await pool.request().query(`UPDATE TEMPCHEQUES SET CODIGO_UNICO_AF='${uniqueCode}' WHERE FOLIO=${folio}`)

    const ultimofolioimprimirformatoconcuentaQuery = await pool.request().query(`SELECT vecesimprimirformatoconcuenta,ultimofolioimprimirformatoconcuenta FROM parametros`)
    const ultimofolioimprimirformatoconcuenta = ultimofolioimprimirformatoconcuentaQuery.recordset[0].ultimofolioimprimirformatoconcuenta
    console.log(ultimofolioimprimirformatoconcuenta)
    await pool.request().query(`UPDATE parametros SET ultimofolioimprimirformatoconcuenta=1`)
    await pool.request().query(`UPDATE parametros SET ultimofolioimprimirformatoconcuenta=${ultimofolioimprimirformatoconcuenta}`)

    await sendResponse(
      'PRINT_SUCCESS',
      {
        folio,
        message: 'Impresión (marcada) realizada con éxito.'
      },
      correlationId
    )

    await transaction.commit()

    // Después de la impresión, se inicia el pago
    return await processPayment(folio, idFormadepago, importe, propina, venueId, referencia, correlationId)
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr)
      }
    }

    console.error('Error en printAndPay:', err)

    await sendResponse(
      'PAYMENT_ERROR',
      {
        error: err.message
      },
      correlationId
    )
  }
}

async function processPayment(folio, idFormadepago, importe, propina, venueId, referencia, correlationId) {
  //SECTION - PAYMENT
  console.log('Processing payment with correlationId:', correlationId)

  try {
    transaction = new Transaction(pool)
    await transaction.begin()

    let request = transaction.request()

    // 🔎 1. VALIDACIONES INICIALES
    const cuentaQuery = await request.input('folio', folio).query(`
      SELECT impreso, pagado FROM tempcheques WHERE folio = @folio
    `)

    if (!cuentaQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: `La cuenta con folio ${folio} no fue encontrada.`
        },
        correlationId
      )
      throw new Error('Cuenta no encontrada.')
    }

    const { impreso, pagado } = cuentaQuery.recordset[0]

    if (pagado) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'La cuenta ya está pagada.'
        },
        correlationId
      )
      throw new Error('Cuenta ya está pagada.')
    }

    const { recordset: config } = await request.query(`
      SELECT pagarsinimprimir FROM configuracion
    `)

    if (!impreso && !config[0].pagarsinimprimir) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'Debes imprimir antes de pagar.'
        },
        correlationId
      )
      throw new Error('Debes imprimir antes de pagar.')
    }

    // 🖥️ Obtener idestacion dinámicamente usando hostname
    const hostname = os.hostname()

    request = transaction.request() // Nuevo request
    const estacionQuery = await request.input('hostname', hostname).query(`
      SELECT idestacion, seriefolio FROM estaciones WHERE idestacion = @hostname
    `)

    if (!estacionQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'Estación no encontrada.'
        },
        correlationId
      )
      throw new Error('Estación no encontrada.')
    }

    const { idestacion, seriefolio: serie } = estacionQuery.recordset[0]

    request = transaction.request() // Nuevo request
    const turnoQuery = await request.input('idestacion', idestacion).query(`
      SELECT TOP 1 idturno, cajero FROM turnos 
      WHERE cierre IS NULL AND apertura IS NOT NULL 
      AND idestacion=@idestacion
    `)

    if (!turnoQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'Turno no abierto.'
        },
        correlationId
      )
      throw new Error('Turno no abierto.')
    }

    const { idturno, cajero } = turnoQuery.recordset[0]

    // 📝 2. INSERT del pago en tempchequespagos
    request = transaction.request() // Nuevo request

    await request.input('folio', folio).input('idFormadepago', idFormadepago).input('importe', importe).input('propina', propina).input('referencia', referencia).query(`
        INSERT INTO tempchequespagos 
        (folio, idformadepago, importe, propina, tipodecambio, referencia, importe_cashdro)
        VALUES (@folio, @idFormadepago, @importe, @propina, 1.0, @referencia, 0.0)
      `)

    // 📝 Asigna número de cheque desde tabla folios dinámicamente
    request = transaction.request() // Nuevo request
    const foliosQuery = await request.input('serie', serie).query(`
      SELECT ultimofolio FROM folios WITH(TABLOCKX) WHERE serie=@serie
    `)

    if (!foliosQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: 'Serie de folios no encontrada.'
        },
        correlationId
      )
      throw new Error('Serie de folios no encontrada.')
    }

    const numcheque = foliosQuery.recordset[0].ultimofolio + 1

    request = transaction.request() // Nuevo request
    await request.input('numcheque', numcheque).input('serie', serie).query(`
        UPDATE folios SET ultimofolio = @numcheque WHERE serie = @serie
      `)

    request = transaction.request() // Nuevo request
    await request.input('numcheque', numcheque).input('idturno', idturno).input('cajero', cajero).input('folio', folio).query(`
        UPDATE tempcheques 
        SET 
          cierre = GETDATE(), 
          pagado = 1, 
          impreso = 1, 
          numcheque = @numcheque, 
          idturno = @idturno, 
          usuariopago = @cajero
        WHERE folio = @folio
      `)

    // 3️⃣ VALIDACIÓN CRÍTICA ANTES DE LIBERAR MESAS
    request = transaction.request() // Nuevo request
    const mesasQuery = await request.input('folio', folio).query(`
      SELECT DISTINCT idmesa FROM mesasasignadas WHERE folio=@folio
    `)

    for (const mesa of mesasQuery.recordset) {
      request = transaction.request() // Nuevo request para cada mesa
      const mesaEnUsoQuery = await request.input('idmesa', mesa.idmesa).query(`
        SELECT COUNT(*) as cuenta FROM mesasasignadas ma
        INNER JOIN tempcheques tc ON ma.folio=tc.folio
        WHERE ma.idmesa=@idmesa AND ma.activo=1 AND tc.pagado=0 AND tc.cancelado=0
      `)

      const mesaEnUso = mesaEnUsoQuery.recordset[0].cuenta > 0

      if (!mesaEnUso) {
        request = transaction.request() // Nuevo request
        await request.input('idmesa', mesa.idmesa).query(`
          UPDATE mesas SET estatus_ocupacion=0 WHERE idmesa=@idmesa
        `)
      }
    }

    request = transaction.request() // Nuevo request
    await request.input('folio', folio).query(`
      UPDATE mesasasignadas SET activo=0 WHERE folio=@folio
    `)

    await transaction.commit()
    console.log('Pago registrado correctamente con correlationId:', correlationId)

    await sendResponse(
      'PAYMENT_SUCCESS',
      {
        folio,
        message: 'Pago registrado correctamente.'
      },
      correlationId
    )
  } catch (error) {
    if (transaction && !transaction._aborted) {
      try {
        await transaction.rollback()
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr)
      }
    }

    await sendResponse(
      'PAYMENT_ERROR',
      {
        folio,
        error: error.message
      },
      correlationId
    )

    console.error('Error in processPayment:', error)
  }
}

// For starting/stopping the service if using node-windows
export default {
  connectToRabbitMQ,
  handleGetShifts,
  handleRequestWaiters,
  handleGetProductosYCategorias,
  handlePrintAndPay
}
