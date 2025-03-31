// src/services/handlers/index.js
import * as shifts from './shifts.js'
import * as waiters from './waiters.js'
import * as products from './products.js'
import * as payments from './payments.js'
import * as ping from './ping.js'

export { shifts, waiters, products, payments, ping }

export default {
  shifts,
  waiters,
  products,
  payments,
  ping
}
