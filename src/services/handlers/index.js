// src/services/handlers/index.js
import * as shifts from './shifts.js'
import * as waiters from './waiters.js'
import * as products from './products.js'
import * as payments from './payments.js'

export { shifts, waiters, products, payments }

export default {
  shifts,
  waiters,
  products,
  payments
}
