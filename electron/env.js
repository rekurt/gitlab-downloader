/**
 * Environment configuration for Electron app
 * Handles dev and production environment settings
 */

const isDev = require('electron-is-dev');

module.exports = {
  isDev,
  API_PORT: process.env.API_PORT || 5000,
  API_HOST: process.env.API_HOST || '127.0.0.1',
  LOG_LEVEL: isDev ? 'debug' : 'info',
  DEBUG: isDev,
};
