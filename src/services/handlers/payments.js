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
 * Handle PRINT_AND_PAY operation
 * @param {Object} data - Request data
 * @param {string} correlationId - Correlation ID for tracking request-response
 */
export async function handlePrintAndPay(data, correlationId) {
  console.log('data', data)
  console.log('Processing print and pay with correlationId:', correlationId)

  const folio = data.folio
  const idFormadepago = 'ACARD' // Assuming payment method is always AVO
  // const tipodecambio = 1.0
  const importe = data.importe / 100
  const propina = data.propina / 100 ?? 0.0
  const referencia = data.referencia ?? `Pago desde AvoqadoTpv, TPV: ${data.tpvId}`
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
      console.log(cuentaQuery)
    if (!cuentaQuery.recordset.length) {
      await sendResponse(
        'PAYMENT_ERROR',
        {
          folio,
          message: `La cuenta con folio ${folio} no fue encontrada.`
        },
        correlationId,
        venueId
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
        correlationId,
        venueId
      )
      throw new Error('Cuenta ya está pagada.')
    }

    // 🖥️ Obtener seriefolio dinámicamente usando hostname
    const hostname = getHostname()
    let seriefolio = null

    const estacionQuery = await pool.request().input('hostname', hostname).query(`
      SELECT seriefolio FROM estaciones WHERE idestacion = @hostname
    `)

    if (estacionQuery.recordset.length > 0) {
      seriefolio = estacionQuery.recordset[0].seriefolio || null
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
        correlationId,
        venueId
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

    // Get folio based on seriefolio - handling NULL case
    let ultimoFolioQuery
    if (seriefolio !== null) {
      ultimoFolioQuery = await pool.request().input('serie', seriefolio).query(`
        SELECT ultimofolio FROM folios WITH (TABLOCKX) WHERE serie=@serie
      `)
    } else {
      ultimoFolioQuery = await pool.request().query(`
        SELECT ultimofolio FROM folios WITH (TABLOCKX) WHERE serie IS NULL OR serie = ''
      `)
    }

    // If no record found, get any record as fallback
    if (!ultimoFolioQuery.recordset.length) {
      ultimoFolioQuery = await pool.request().query(`
        SELECT TOP 1 ultimofolio FROM folios WITH (TABLOCKX)
      `)
    }

    const ultimoFolio = ultimoFolioQuery.recordset.length > 0 ? ultimoFolioQuery.recordset[0].ultimofolio : 1

    console.log(ultimoFolio)

    // Update tempcheques with dynamic seriefolio - handle null values and prevent truncation
    if (seriefolio === null || seriefolio === '') {
      await pool
        .request()
        .input('ultimoFolio', ultimoFolio)
        .input('folio', folio)
        .query(
          `UPDATE tempcheques WITH(TABLOCK) SET impreso=1,numcheque=@ultimoFolio,cierre=GETDATE(),impresiones=impresiones+1,seriefolio=NULL,cambiorepartidor=0.000000,campoadicional1='000000000100000',codigo_unico_af='',domicilioprogramado=0,autorizacionfolio='' WHERE folio=@folio`
        )
    } else {
      // Ensure seriefolio is not too long - take first character only
      const serieChar = seriefolio.toString().charAt(0) || 'A'
      await pool
        .request()
        .input('ultimoFolio', ultimoFolio)
        .input('folio', folio)
        .input('seriefolio', serieChar)
        .query(
          `UPDATE tempcheques WITH(TABLOCK) SET impreso=1,numcheque=@ultimoFolio,cierre=GETDATE(),impresiones=impresiones+1,seriefolio=@seriefolio,cambiorepartidor=0.000000,campoadicional1='000000000100000',codigo_unico_af='',domicilioprogramado=0,autorizacionfolio='' WHERE folio=@folio`
        )
    }

    // Update folios with dynamic seriefolio
    if (seriefolio !== null) {
      await pool.request().input('ultimoFolio', ultimoFolio).input('serie', seriefolio).query(`UPDATE folios WITH(TABLOCK) SET ultimofolio=@ultimoFolio WHERE serie=@serie`)
    } else {
      await pool.request().input('ultimoFolio', ultimoFolio).query(`UPDATE folios WITH(TABLOCK) SET ultimofolio=@ultimoFolio WHERE serie IS NULL OR serie = ''`)
    }

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
        correlationId,
        venueId
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
        correlationId,
        venueId
      )
      throw new Error('Estación no encontrada.')
    }

    const { idestacion, seriefolio } = estacionQuery.recordset[0]
    // Handle NULL or empty seriefolio - assuming seriefolio is VARCHAR(1) based on screenshots
    // Default to null and ensure we're not exceeding column size
    let serie = seriefolio || null
    // If seriefolio is not null but is an empty string, explicitly set to null
    if (serie === '') {
      serie = null
    }

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
        correlationId,
        venueId
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
    let numcheque = 1 // Default value

    request = transaction.request() // Nuevo request

    // Modified query to handle NULL or empty serie
    const foliosQuery =
      serie !== null
        ? await request.input('serie', serie).query(`
        SELECT ultimofolio FROM folios WITH(TABLOCKX) WHERE serie=@serie
      `)
        : await request.query(`
        SELECT TOP 1 ultimofolio FROM folios WITH(TABLOCKX) WHERE serie IS NULL OR serie = ''
      `)

    if (foliosQuery.recordset.length) {
      numcheque = foliosQuery.recordset[0].ultimofolio + 1

      request = transaction.request() // Nuevo request

      // Update query modified to handle NULL or empty serie
      if (serie !== null) {
        await request.input('numcheque', numcheque).input('serie', serie).query(`
          UPDATE folios SET ultimofolio = @numcheque WHERE serie = @serie
        `)
      } else {
        await request.input('numcheque', numcheque).query(`
          UPDATE folios SET ultimofolio = @numcheque WHERE serie IS NULL OR serie = ''
        `)
      }
    } else {
      // If no matching record found, log a warning but continue
      console.warn(`No matching folios record found for serie: ${serie}`)

      // Use a default value or query the default folios record
      const defaultFoliosQuery = await request.query(`
        SELECT TOP 1 ultimofolio FROM folios WITH(TABLOCKX)
      `)

      if (defaultFoliosQuery.recordset.length) {
        numcheque = defaultFoliosQuery.recordset[0].ultimofolio + 1
      }
    }

    request = transaction.request() // Nuevo request

    // Handle NULL seriefolio in the SQL query directly
    if (serie === null) {
      await request.input('numcheque', numcheque).input('idturno', idturno).input('cajero', cajero).input('folio', folio).query(`
        UPDATE tempcheques 
        SET 
          cierre = GETDATE(), 
          pagado = 1, 
          impreso = 1, 
          numcheque = @numcheque, 
          idturno = @idturno, 
          usuariopago = @cajero,
          seriefolio = ''
        WHERE folio = @folio
      `)
    } else {
      // If we have a seriefolio value, ensure it's not too long by taking just the first character
      // This addresses the truncation error, assuming seriefolio is VARCHAR(1)
      const serieChar = serie.toString().charAt(0) || 'A'
      await request.input('numcheque', numcheque).input('idturno', idturno).input('cajero', cajero).input('folio', folio).input('serie', serieChar).query(`
        UPDATE tempcheques 
        SET 
          cierre = GETDATE(), 
          pagado = 1, 
          impreso = 1, 
          numcheque = @numcheque, 
          idturno = @idturno, 
          usuariopago = @cajero,
          seriefolio = @serie
        WHERE folio = @folio
      `)
    }

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
      correlationId,
      venueId
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
      correlationId,
      venueId
    )

    console.error('Error in processPayment:', error)
  }
}

export default {
  handlePrintAndPay,
  processPayment
}
