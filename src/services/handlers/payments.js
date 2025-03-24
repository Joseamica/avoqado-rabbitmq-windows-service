// src/services/handlers/payments.js
import pkg from 'mssql'

import { createDbPool } from '../../config/database.js'
import { sendResponse } from '../rabbitmq/index.js'
import { logError } from '../../utils/logger.js'
import { generateUniqueCode, getHostname } from '../../utils/helper.js'

const { Transaction } = pkg
let pool

// Initialize database pool
async function initPool() {
  if (!pool) {
    pool = await createDbPool()
  }
  return pool
}

/**
 * Process payment after printing
 * @param {string} folio - Receipt number
 * @param {string} idFormadepago - Payment method ID
 * @param {number} importe - Payment amount
 * @param {number} propina - Tip amount
 * @param {string} venueId - Venue ID
 * @param {string} referencia - Payment reference
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function processPayment(folio, idFormadepago, importe, propina, venueId, referencia, correlationId) {
  //SECTION - PAYMENT
  console.log('Processing payment with correlationId:', correlationId)
  let transaction

  try {
    pool = await initPool()
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
    const hostname = getHostname()

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

    logError(`Error processing payment: ${error.message}`)
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

/**
 * Handle PRINT_AND_PAY operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handlePrintAndPay(data, correlationId) {
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
    pool = await initPool()
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

    logError(`Error in printAndPay: ${err.message}`)
    console.error('Error en printAndPay:', err)

    await sendResponse(
      'PAYMENT_ERROR',
      {
        folio,
        error: err.message
      },
      correlationId
    )
  }
}

export default {
  handlePrintAndPay,
  processPayment
}
