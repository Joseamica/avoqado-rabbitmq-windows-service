// src/utils/helpers.js
import * as os from 'os'

/**
 * Get the local hostname
 * @returns {string} Machine hostname
 */
export function getHostname() {
  return os.hostname()
}

/**
 * Generate a unique random code
 * @param {number} length - Length of the code to generate
 * @returns {string} Random alphanumeric code
 */
export function generateUniqueCode(length = 9) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

/**
 * Format date for SQL queries
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatSqlDate(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export default {
  getHostname,
  generateUniqueCode,
  formatSqlDate
}
