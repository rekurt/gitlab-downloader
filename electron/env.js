/**
 * Environment configuration for Electron app
 * Handles dev and production environment settings
 */

const isDev = require("electron-is-dev");

module.exports = {
  isDev,
  LOG_LEVEL: isDev ? "debug" : "info",
  DEBUG: isDev,
};
