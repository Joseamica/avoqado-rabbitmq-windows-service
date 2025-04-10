// src/services/handlers/payments.js
import pkg from 'mssql'

import { createDbPool } from '../../config/database.js'
import { sendResponse } from '../rabbitmq/index.js'
import { logInfo, logError, logDebug } from '../../utils/logger.js'
import { generateUniqueCode, getHostname } from '../../utils/helper.js'

const { Transaction, VarChar, Int, Money, DateTime, Bit, Decimal } = pkg
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
  const importe = Number(data.importe) / 100
  const propina = (Number(data.propina) / 100) || 0.0
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

    await request
      .input('folio', folio)
      .input('idFormadepago', idFormadepago)
      .input('importe', Money, importe)
      .input('propina', Money, propina)
      .input('referencia', referencia)
      .query(`
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

/**
 * Handle PARTIAL_PAYMENT operation with proper product handling
 * @param {Object} data - Payment data 
 * @param {string} correlationId - Correlation ID
 */
export async function handlePartialPayment(data, correlationId) {
  logInfo(`Processing partial payment with correlationId: ${correlationId}`)
  
  const folio = data.folio
  const partialAmount = data.importe / 100
  const propina = data.propina / 100 || 0.0
  const referencia = data.referencia || `Pago parcial desde AvoqadoTpv, TPV: ${data.tpvId}`
  const venueId = data.venueId || 'madre_cafecito'
  const paymentMethod = 'ACARD'
  
  let pool, transaction
  
  try {
    // 1. Connect to the database
    pool = await initPool()
    logInfo('Database connection established')
    
    // 2. Ensure our tracking table exists
    await ensurePartialPaymentsTable(pool)
    await pool.request()
    .input('originalFolio', folio)
    .query(`
      UPDATE AvoqadoPartialPayments
      SET status = 'ABANDONED'
      WHERE original_folio = @originalFolio
      AND status IN ('PENDING', 'CREATED')
      AND DATEDIFF(MINUTE, payment_timestamp, GETDATE()) > 30
    `)
  logInfo('Cleaned up any abandoned partial payments')
    logInfo('Ensured partial payments tracking table exists')
    
    // 3. Begin transaction
    transaction = new Transaction(pool)
    await transaction.begin()
    logInfo('Transaction started')
    
    try {
      // 4. Get original bill information
      logInfo(`Getting bill info for folio: ${folio}`)
      const billQuery = await transaction.request()
      .input('folio', folio)
      .query(`
        SELECT 
          folio, total, pagado, impreso, mesa, nopersonas, idmesero, 
          idcliente, idarearestaurant, idempresa, tipodeservicio, 
          estacion, Usuarioapertura, subtotal, totalimpuesto1,
          orden, numcheque, seriefolio
        FROM tempcheques WITH (NOLOCK)
        WHERE folio = @folio
      `)
      
      if (!billQuery.recordset.length) {
        throw new Error(`Bill ${folio} not found`)
      }
      
      const originalBill = billQuery.recordset[0]
      logInfo(`Found bill with total: ${originalBill.total}`)
      
      if (originalBill.pagado === 1) {
        throw new Error(`Bill ${folio} is already paid`)
      }
      
      const totalAmount = Number(originalBill.total)
      
      if (partialAmount >= totalAmount) {
        // If paying full amount or more, process as full payment
        logInfo(`Amount ${partialAmount} >= total ${totalAmount}, processing as full payment`)
        await transaction.rollback()
        return await processPayment(folio, paymentMethod, partialAmount, propina, venueId, referencia, correlationId)
      }
      
      // 5. Get all products from the original bill
      logInfo('Getting all products from original bill')
      const productsQuery = await transaction.request()
        .input('folio', folio)
        .query(`
   SELECT 
      foliodet, movimiento, cantidad, idproducto, 
      descuento, precio, preciosinimpuestos, comentario,
      tiempo, hora, modificador, mitad, idestacion,
      impuesto1, impuesto2, impuesto3, idmeseroproducto,
      sistema_envio, promovolumen
    FROM tempcheqdet WITH (NOLOCK)
    WHERE foliodet = @folio
        `)
      
      if (!productsQuery.recordset.length) {
        throw new Error(`No products found for bill ${folio}`)
      }
      
      const products = productsQuery.recordset
      logInfo(`Found ${products.length} products on original bill`)
      
      // 6. Calculate payment ratio and remaining ratio
      const paymentRatio = Math.round((partialAmount / totalAmount) * 10000) / 10000
      const remainingRatio = Math.round((1 - paymentRatio) * 10000) / 10000
      
      logInfo(`Payment ratio: ${paymentRatio}, Remaining ratio: ${remainingRatio}`)
      
      // 7. Calculate amounts to be moved to the new bill vs. remaining
      let totalPartialAmount = 0
      let totalRemainingAmount = 0
      
      // Create proportional distribution arrays for both bills
      const partialProducts = []
      const remainingProducts = []
      
      for (const product of products) {
        const productTotal = Number(product.precio) * Number(product.cantidad)
        const productPartialAmount = Math.round(productTotal * paymentRatio * 100) / 100
        const productRemainingAmount = Math.round(productTotal * remainingRatio * 100) / 100
        
        // For the partial payment bill
        partialProducts.push({
          ...product,
          precio: product.precio,
          cantidad: product.cantidad * paymentRatio,
          productTotal: productPartialAmount
        })
        
        // For the remaining amount on original bill
        remainingProducts.push({
          ...product,
          precio: product.precio,
          cantidad: product.cantidad * remainingRatio,
          productTotal: productRemainingAmount
        })
        
        totalPartialAmount += productPartialAmount
        totalRemainingAmount += productRemainingAmount
      }
      
      logInfo(`Total partial amount calculated: ${totalPartialAmount}`)
      logInfo(`Total remaining amount calculated: ${totalRemainingAmount}`)
      
      // Adjust for any rounding errors
      if (Math.abs(totalPartialAmount - partialAmount) > 0.01) {
        logInfo(`Adjusting partial amount from ${totalPartialAmount} to ${partialAmount} (difference: ${totalPartialAmount - partialAmount})`)
        // Adjust the largest product to make up the difference
        partialProducts.sort((a, b) => b.productTotal - a.productTotal)
        const adjustment = partialAmount - totalPartialAmount
        partialProducts[0].productTotal += adjustment
        partialProducts[0].cantidad = partialProducts[0].productTotal / partialProducts[0].precio
      }
      
      if (Math.abs(totalRemainingAmount - (totalAmount - partialAmount)) > 0.01) {
        logInfo(`Adjusting remaining amount from ${totalRemainingAmount} to ${totalAmount - partialAmount} (difference: ${totalRemainingAmount - (totalAmount - partialAmount)})`)
        // Adjust the largest product to make up the difference
        remainingProducts.sort((a, b) => b.productTotal - a.productTotal)
        const adjustment = (totalAmount - partialAmount) - totalRemainingAmount
        remainingProducts[0].productTotal += adjustment
        remainingProducts[0].cantidad = remainingProducts[0].productTotal / remainingProducts[0].precio
      }
      
      // 8. Calculate remaining amounts for bill totals
      const remainingAmount = totalAmount - partialAmount
      logInfo(`Final remaining amount: ${remainingAmount}`)
      
      // Recalculate tax rates for the bills
      const taxRate = originalBill.totalimpuesto1 > 0 ? 
        (originalBill.totalimpuesto1 / originalBill.subtotal) * 100 : 0
      logInfo(`Tax rate: ${taxRate}%`)
      
      const partialSubtotal = partialAmount / (1 + (taxRate / 100))
      const partialTax = partialAmount - partialSubtotal
      
      const remainingSubtotal = remainingAmount / (1 + (taxRate / 100))
      const remainingTax = remainingAmount - remainingSubtotal
      
      // 9. Generate a tracking ID for this partial payment
      const now = new Date()
      const shortDate = `${now.getMonth()+1}${now.getDate()}${now.getHours()}${now.getMinutes()}`
      
      // Check for existing partial payments on this bill to get the counter
      const counterQuery = await transaction.request()
        .input('originalFolio', folio)
        .query(`
          SELECT COUNT(*) as counter
          FROM AvoqadoPartialPayments
          WHERE original_folio = @originalFolio
        `)
      
      const counter = counterQuery.recordset[0].counter + 1
      if (counter > 1) {
        logInfo(`This is payment #${counter} on bill ${folio}, adding short delay`)
        // Add a short delay before proceeding
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      // Make tracking ID unique with counter and milliseconds
      const trackingId = `${folio}-P${shortDate}${now.getSeconds()}${now.getMilliseconds()}-${counter}`
      
      // 10. Create modified mesa (table) name for the partial payment
      const modifiedMesa = `P${counter}${originalBill.mesa}`;
            logInfo(`Using modified table name: ${modifiedMesa} for partial payment`)
      
      // 11. Record this partial payment in our tracking table
      logInfo('Recording partial payment in tracking table')
      
      await transaction.request()
        .input('trackingId', trackingId)
        .input('originalFolio', folio)
        .input('partialAmount', partialAmount)
        .input('tip', propina)
        .input('paymentMethod', paymentMethod)
        .input('referencia', referencia)
        .input('timestamp', now)
        .input('correlationId', correlationId)
        .input('remainingAmount', remainingAmount)
        .input('venueId', venueId)
        .input('productId', products[0].idproducto)
        .input('taxRate', taxRate)
        .input('metadata', JSON.stringify({
          originalFolio: folio,
          originalMesa: originalBill.mesa,
          modifiedMesa: modifiedMesa,
          counter: counter,
          productsCount: products.length
        }))
        .input('counter', counter)
        .query(`
          INSERT INTO AvoqadoPartialPayments (
            tracking_id, original_folio, amount, tip, payment_method,
            reference, payment_timestamp, correlation_id, remaining_amount,
            venue_id, product_id, tax_rate, status, metadata,
            counter
          ) VALUES (
            @trackingId, @originalFolio, @partialAmount, @tip, @paymentMethod,
            @referencia, @timestamp, @correlationId, @remainingAmount,
            @venueId, @productId, @taxRate, 'PENDING', @metadata,
            @counter
          )
        `)
      
      // 12. Create the new bill for the partial payment
      logInfo('Creating new bill for partial payment')
      
      const insertResult = await transaction.request()
        .input('fecha', now)
        .input('modifiedMesa', modifiedMesa)  // Using modified table name here
        .input('nopersonas', originalBill.nopersonas)
        .input('idmesero', originalBill.idmesero)
        .input('idcliente', originalBill.idcliente || '')
        .input('idarearestaurant', originalBill.idarearestaurant)
        .input('idempresa', originalBill.idempresa)
        .input('tipodeservicio', originalBill.tipodeservicio)
        .input('estacion', originalBill.estacion)
        .input('usuarioapertura', originalBill.Usuarioapertura)
        .input('orden', originalBill.orden + counter)  // Use original bill's orden + counter
        .input('observaciones', `Pago parcial #${counter} de cuenta ${folio}`)
        .query(`
          INSERT INTO tempcheques(
            fecha, mesa, nopersonas, idmesero, 
            pagado, impreso, impresiones, cambio, descuento, 
            orden, idcliente, idarearestaurant, idempresa, 
            tipodeservicio, estacion, Usuarioapertura, observaciones
          ) 
          VALUES (
            @fecha, @modifiedMesa, @nopersonas, @idmesero,
            0, 0, 0, 0, 0.000000,
            @orden, @idcliente, @idarearestaurant, @idempresa,
            @tipodeservicio, @estacion, @usuarioapertura, @observaciones
          );
          
          SELECT SCOPE_IDENTITY() AS newFolio;
        `)
      
      // Get the newly generated folio
      const partialFolio = insertResult.recordset[0].newFolio
      logInfo(`New bill created with folio: ${partialFolio}`)
      
      // 13. Update the tracking table with the new bill folio
      await transaction.request()
        .input('trackingId', trackingId)
        .input('partialFolio', partialFolio)
        .query(`
          UPDATE AvoqadoPartialPayments
          SET bill_folio = @partialFolio, status = 'CREATED'
          WHERE tracking_id = @trackingId
        `)
      
      // 14. Insert entry in cuentas table with the modified mesa
      logInfo('Creating cuentas entry for partial bill')
      await transaction.request()
        .input('partialFolio', partialFolio)
        .input('modifiedMesa', modifiedMesa)  // Using modified table name here
        .input('idmesero', originalBill.idmesero)
        .input('nopersonas', originalBill.nopersonas)
        .input('idarearestaurant', originalBill.idarearestaurant)
        .input('estacion', originalBill.estacion)
        .query(`
          INSERT INTO cuentas (
            clavemesa, clavemesero, numeropersonas, clavearea,
            estacion, imprimir, tiposervicio, enviadosr, foliocuenta, idmesa
          ) VALUES (
            @modifiedMesa, @idmesero, @nopersonas, @idarearestaurant, 
            @estacion, 0, 1, 1, @partialFolio, ''
          )
        `)
      
      // 15. Add product entries for the partial payment bill - proportional to the original products
      logInfo(`Adding ${partialProducts.length} products to partial bill`)
      
      // for (let i = 0; i < partialProducts.length; i++) {
      //   const product = partialProducts[i]
      //   await transaction.request()
      //     .input('partialFolio', partialFolio)
      //     .input('movimiento', i + 1)
      //     .input('cantidad', product.cantidad)
      //     .input('idproducto', product.idproducto)
      //     .input('precio', product.precio)
      //     .input('preciosinimpuestos', product.preciosinimpuestos)
      //     .input('comentario', `Pago parcial #${counter} de producto en cuenta ${folio}`)
      //     .input('fecha', now)
      //     .input('estacion', originalBill.estacion)
      //     .input('impuesto1', product.impuesto1)
      //     .input('impuesto2', product.impuesto2 || 0)
      //     .input('impuesto3', product.impuesto3 || 0)
      //     .input('idmesero', originalBill.idmesero)
      //     .query(`
      //       INSERT INTO tempcheqdet (
      //         foliodet, movimiento, cantidad, idproducto, 
      //         descuento, precio, preciosinimpuestos, comentario, tiempo,
      //         hora, modificador, mitad, idestacion,
      //         impuesto1, impuesto2, impuesto3, idmeseroproducto,
      //         sistema_envio, promovolumen
      //       ) VALUES (
      //         @partialFolio, @movimiento, @cantidad, @idproducto,
      //         0.000000, @precio, @preciosinimpuestos, @comentario, '',
      //         @fecha, 0, 0.000000, @estacion,
      //         @impuesto1, @impuesto2, @impuesto3, @idmesero,
      //         1, 0
      //       )
      //     `)
      // }
      
      // 16. Update the original bill products with reduced quantities
      // logInfo(`Updating ${remainingProducts.length} products on original bill with reduced quantities`)
      
      for (let i = 0; i < remainingProducts.length; i++) {
        const product = remainingProducts[i]
        await transaction.request()
          .input('folio', folio)
          .input('movimiento', product.movimiento)
          .input('cantidad', product.cantidad)
          .query(`
            UPDATE tempcheqdet 
            SET cantidad = @cantidad
            WHERE foliodet = @folio AND movimiento = @movimiento
          `)
      }
      
      // 17. Update the totals on the partial payment bill
      logInfo('Updating totals on partial bill')
      await transaction.request()
        .input('partialFolio', partialFolio)
        .input('partialAmount', partialAmount)
        .input('partialSubtotal', partialSubtotal)
        .input('partialTax', partialTax)
        .query(`
          UPDATE tempcheques SET
            totalarticulos = @partialAmount,
            subtotal = @partialSubtotal,
            total = @partialAmount,
            totalconpropina = @partialAmount,
            totalsindescuento = @partialAmount,
            totalimpuesto1 = @partialTax,
            subtotalcondescuento = @partialSubtotal

          WHERE folio = @partialFolio
        `)
      
      // 18. Update the original bill with the reduced amount
      logInfo('Updating original bill with remaining amount')
      await transaction.request()
        .input('folio', folio)
        .input('remainingAmount', remainingAmount)
        .input('remainingSubtotal', remainingSubtotal)
        .input('remainingTax', remainingTax)
        .input('partialAmount', partialAmount)
        .input('trackingId', trackingId)
        .query(`
          UPDATE tempcheques SET
            total = @remainingAmount,
            subtotal = @remainingSubtotal,
            totalimpuesto1 = @remainingTax,
            totalconpropina = @remainingAmount,
            totalsindescuento = @remainingAmount,
            totalsindescuentoimp = @remainingAmount,
            totalconpropinacargo = @remainingAmount,
            totalconcargo = @remainingAmount,
            subtotalcondescuento = @remainingSubtotal,
            observaciones = CONCAT(ISNULL(observaciones, ''), ' - Pago parcial #${counter} de $', CAST(@partialAmount AS VARCHAR(20)), ' aplicado. Ref: ', @trackingId)
          WHERE folio = @folio
        `)
      
      // 19. Update cuentas for the original bill
      logInfo('Updating cuentas for original bill')
      await transaction.request()
        .input('folio', folio)
        .input('remainingAmount', remainingAmount)
        .input('remainingSubtotal', remainingSubtotal)
        .input('remainingTax', remainingTax)
        .query(`
          UPDATE cuentas SET
            total = @remainingAmount,
            subtotal = @remainingSubtotal,
            totalimpuesto1 = @remainingTax
          WHERE foliocuenta = @folio
        `)
      
      // 20. Commit the transaction for bill creation
      await transaction.commit()
      logInfo('Transaction for bill creation committed successfully')
      
      // 21. Update tracking table status 
      await pool.request()
        .input('trackingId', trackingId)
        .query(`
          UPDATE AvoqadoPartialPayments
          SET status = 'CREATED'
          WHERE tracking_id = @trackingId
        `)
      
      // 22. Now handle printing the bill - This is required before payment
      logInfo(`Marking bill as printed: ${partialFolio}`)
      
      // Similar to what handlePrintAndPay does before payment
      const printTransaction = new Transaction(pool)
      await printTransaction.begin()
      
      try {
        // 🖥️ Obtain hostname for station identification
        const hostname = getHostname()
        let seriefolio = null
        
        // Get seriefolio from estaciones
        const estacionQuery = await pool.request().input('hostname', hostname).query(`
          SELECT seriefolio FROM estaciones WHERE idestacion = @hostname
        `)
        
        if (estacionQuery.recordset.length > 0) {
          seriefolio = estacionQuery.recordset[0].seriefolio || null
        }
        
        // Get folio based on seriefolio - handling NULL case
        let ultimoFolioQuery
        if (seriefolio !== null) {
          ultimoFolioQuery = await printTransaction.request().input('serie', seriefolio).query(`
            SELECT ultimofolio FROM folios WITH (TABLOCKX) WHERE serie=@serie
          `)
        } else {
          ultimoFolioQuery = await printTransaction.request().query(`
            SELECT ultimofolio FROM folios WITH (TABLOCKX) WHERE serie IS NULL OR serie = ''
          `)
        }
        
        // If no record found, get any record as fallback
        if (!ultimoFolioQuery.recordset.length) {
          ultimoFolioQuery = await printTransaction.request().query(`
            SELECT TOP 1 ultimofolio FROM folios WITH (TABLOCKX)
          `)
        }
        
        const ultimoFolio = ultimoFolioQuery.recordset.length > 0 ? ultimoFolioQuery.recordset[0].ultimofolio : 1
        
        // Mark the bill as printed by updating impreso and other fields
        if (seriefolio === null || seriefolio === '') {
          await printTransaction.request()
            .input('ultimoFolio', ultimoFolio)
            .input('partialFolio', partialFolio)
            .query(
              `UPDATE tempcheques WITH(TABLOCK) SET impreso=1,numcheque=@ultimoFolio,cierre=GETDATE(),impresiones=impresiones+1,seriefolio=NULL,cambiorepartidor=0.000000,campoadicional1='000000000100000',codigo_unico_af='',domicilioprogramado=0,autorizacionfolio='' WHERE folio=@partialFolio`
            )
        } else {
          const serieChar = seriefolio.toString().charAt(0) || 'A'
          await printTransaction.request()
            .input('ultimoFolio', ultimoFolio)
            .input('partialFolio', partialFolio)
            .input('seriefolio', serieChar)
            .query(
              `UPDATE tempcheques WITH(TABLOCK) SET impreso=1,numcheque=@ultimoFolio,cierre=GETDATE(),impresiones=impresiones+1,seriefolio=@seriefolio,cambiorepartidor=0.000000,campoadicional1='000000000100000',codigo_unico_af='',domicilioprogramado=0,autorizacionfolio='' WHERE folio=@partialFolio`
            )
        }
        
        // Update folios with dynamic seriefolio
        if (seriefolio !== null) {
          await printTransaction.request()
            .input('ultimoFolio', ultimoFolio)
            .input('serie', seriefolio)
            .query(`UPDATE folios WITH(TABLOCK) SET ultimofolio=@ultimoFolio WHERE serie=@serie`)
        } else {
          await printTransaction.request()
            .input('ultimoFolio', ultimoFolio)
            .query(`UPDATE folios WITH(TABLOCK) SET ultimofolio=@ultimoFolio WHERE serie IS NULL OR serie = ''`)
        }
        
        // Mark bill in cuentas for printing
        await printTransaction.request()
          .input('partialFolio', partialFolio)
          .query(`UPDATE cuentas set imprimir = 1, procesado = 1 where foliocuenta = @partialFolio`)
        
        // Generate and set a unique code
        const uniqueCode = generateUniqueCode() + `-P${counter}`; // Add the partial payment suffix
        await printTransaction.request()
          .input('partialFolio', partialFolio)
          .input('uniqueCode', uniqueCode)
          .query(`UPDATE TEMPCHEQUES SET CODIGO_UNICO_AF=@uniqueCode WHERE FOLIO=@partialFolio`)
        
        // Commit printing transaction
        await printTransaction.commit()
        logInfo(`Successfully marked bill ${partialFolio} as printed`)
        
        // Update tracking table status to PRINTED
        await pool.request()
          .input('trackingId', trackingId)
          .query(`
            UPDATE AvoqadoPartialPayments
            SET status = 'PRINTED'
            WHERE tracking_id = @trackingId
          `)
        
        // 23. Now process payment for the partial bill
        logInfo(`Processing payment for partial bill: ${partialFolio}`)
        try {
          const paymentResult = await processPayment(
            partialFolio, 
            paymentMethod, 
            partialAmount, 
            propina, 
            venueId, 
            referencia, 
            correlationId
          )
          
          // 24. Update tracking table with success status
          await pool.request()
            .input('trackingId', trackingId)
            .query(`
              UPDATE AvoqadoPartialPayments
              SET status = 'COMPLETED'
              WHERE tracking_id = @trackingId
            `)
          
          // 25. Send response including information about both bills
          return {
            operation: 'PAYMENT_SUCCESS',
            data: {
              folio: partialFolio,
              originalFolio: folio,
              partialAmount: partialAmount,
              remainingAmount: remainingAmount,
              trackingId: trackingId,
              counter: counter,
              modifiedMesa: modifiedMesa,
              message: `Pago parcial #${counter} de $${partialAmount} registrado en folio ${partialFolio} (mesa ${modifiedMesa}). Saldo pendiente en folio ${folio}: $${remainingAmount}.`
            }
          }
        } catch (paymentError) {
          // Update tracking table with error status
          await pool.request()
            .input('trackingId', trackingId)
            .input('errorMessage', paymentError.message)
            .query(`
              UPDATE AvoqadoPartialPayments
              SET status = 'PAYMENT_ERROR', error_message = @errorMessage
              WHERE tracking_id = @trackingId
            `)
          
          throw paymentError
        }
      } catch (printError) {
        // Rollback print transaction if it fails
        if (printTransaction && printTransaction._active) {
          await printTransaction.rollback()
        }
        
        // Update tracking record with error
        await pool.request()
          .input('trackingId', trackingId)
          .input('errorMessage', printError.message)
          .query(`
            UPDATE AvoqadoPartialPayments
            SET status = 'PRINT_ERROR', error_message = @errorMessage
            WHERE tracking_id = @trackingId
          `)
        
        throw printError
      }
      
    } catch (error) {
      // Roll back the transaction on error
      logError(`Error in transaction: ${error.message}`)
      if (error.stack) {
        logError(`Error stack: ${error.stack}`)
      }
      
      if (transaction && transaction._active) {
        try {
          await transaction.rollback()
          logInfo('Transaction rolled back successfully')
        } catch (rollbackErr) {
          logError(`Error rolling back transaction: ${rollbackErr.message}`)
        }
      }
      throw error
    }
    
  } catch (error) {
    logError(`Error in partial payment: ${error.message}`)
    if (error.stack) {
      logError(`Error stack: ${error.stack}`)
    }
    
    await sendResponse(
      'PAYMENT_ERROR',
      {
        folio,
        error: error.message,
        stack: error.stack ? error.stack.substring(0, 500) : 'No stack trace'
      },
      correlationId,
      venueId
    )
    
    throw error
  }
}

/**
 * Ensures our custom partial payments tracking table exists
 */
async function ensurePartialPaymentsTable(pool) {
  try {
    // Check if table exists
    const tableCheck = await pool.request().query(`
      SELECT OBJECT_ID('dbo.AvoqadoPartialPayments') as table_id
    `)
    
    if (!tableCheck.recordset[0].table_id) {
      // Create table if it doesn't exist - using SQL Server syntax
      await pool.request().query(`
        CREATE TABLE AvoqadoPartialPayments (
          id INT IDENTITY(1,1) PRIMARY KEY,
          tracking_id VARCHAR(100) NOT NULL,
          original_folio VARCHAR(50) NOT NULL,
          bill_folio VARCHAR(50),
          amount DECIMAL(18,6) NOT NULL,
          tip DECIMAL(18,6) NOT NULL DEFAULT 0,
          payment_method VARCHAR(50) NOT NULL,
          reference VARCHAR(255),
          payment_timestamp DATETIME NOT NULL,
          correlation_id VARCHAR(100),
          remaining_amount DECIMAL(18,6),
          venue_id VARCHAR(100) NOT NULL,
          product_id VARCHAR(50),
          tax_rate DECIMAL(18,6),
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          error_message VARCHAR(500),
          counter INT NOT NULL DEFAULT 1,
          metadata VARCHAR(MAX),
          created_at DATETIME NOT NULL DEFAULT GETDATE()
        )
      `)
      
      // Create indexes separately - compatible with SQL Server
      try {
        await pool.request().query(`
          CREATE UNIQUE INDEX idx_tracking_id ON AvoqadoPartialPayments(tracking_id)
        `)
        await pool.request().query(`
          CREATE INDEX idx_original_folio ON AvoqadoPartialPayments(original_folio)
        `)
        await pool.request().query(`
          CREATE INDEX idx_bill_folio ON AvoqadoPartialPayments(bill_folio)
        `)
        await pool.request().query(`
          CREATE INDEX idx_status ON AvoqadoPartialPayments(status)
        `)
      } catch (indexError) {
        logError(`Non-critical error creating indexes: ${indexError.message}`)
        // Continue even if index creation fails - not critical
      }
      
      logInfo('Created AvoqadoPartialPayments table')
    }
  } catch (error) {
    logError(`Error ensuring partial payments table: ${error.message}`)
    if (error.stack) {
      logError(`Error stack: ${error.stack}`)
    }
    throw error
  }
}
export default {
  handlePrintAndPay,
  processPayment,
  handlePartialPayment
}
