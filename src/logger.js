const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { LOG_PATH } = require('./config');

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

module.exports = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: LOG_PATH, maxsize: 5_000_000, maxFiles: 3 }),
    new winston.transports.Console({
      level: 'warn',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message }) => `[${level}] ${message}`)
      ),
    }),
  ],
});