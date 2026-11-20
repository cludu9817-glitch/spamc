const config = {
  BOT_TOKEN: '9180187910:AAHiw0b8NCsBBFgKPbTxztPiS3UJtT96BJM',
  ADMIN_IDS: [
    // 6708512466,
  ],

  BASE_URL: 'https://ayo.co.id',
  USER_AGENT: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  CHROME_VERSION: '153',

  DB_PATH: './data/bot.db',
  LOG_PATH: './data/bot.log',

  DEFAULT_CONCURRENCY: 3,
  DEFAULT_SPAM_COUNT: 5,
  DEFAULT_DELAY_OTP: 3000,
  DEFAULT_DELAY_TARGET: 2000,
  DEFAULT_MAX_RETRY: 3,

  CALLBACK_THROTTLE_MS: 1200,
  PROGRESS_EDIT_MS: 2500,
  HTTP_TIMEOUT_MS: 20000,

  RATE_LIMIT_HARD_CAP_SEC: 900,
};

if (!config.BOT_TOKEN || config.BOT_TOKEN === 'ISI_TOKEN_DI_SINI') {
  throw new Error('config.BOT_TOKEN kosong — isi token di src/config.js');
}
if (!config.ADMIN_IDS.length) {
  console.warn('[config] ADMIN_IDS kosong — bot menolak semua user.');
}

module.exports = config;