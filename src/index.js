const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const bot = require('./bot');

fs.mkdirSync('./data', { recursive: true });

(async () => {
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Menu utama' },
      { command: 'menu', description: 'Refresh menu' },
    ]);
    await bot.launch({ dropPendingUpdates: true });
    logger.info(`bot live — admin count ${config.ADMIN_IDS.length}`);
    console.log(`[ALPHA XK] bot live. admins: ${config.ADMIN_IDS.length}`);
  } catch (e) {
    logger.error(`launch: ${e.message}`);
    process.exit(1);
  }
})();

function shutdown(sig) {
  logger.info(`received ${sig}, shutting down`);
  try { bot.stop(sig); } catch {}
  try { db.db.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => logger.error(`unhandled: ${e?.message || e}`));
process.on('uncaughtException', (e) => logger.error(`uncaught: ${e?.message || e}`));