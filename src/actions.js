const pLimit = require('p-limit');
const db = require('./db');
const config = require('./config');
const logger = require('./logger');
const { runOne } = require('./ayo');
const { renderProgress, renderSummary } = require('./ui');

async function startRun(bot, chatId, sendProgressMessage) {
  const settings = db.getSettings(chatId);
  const targets = db.listTargets(chatId);
  const proxies = db.listProxies(chatId).map(p => p.url);

  if (!targets.length) return { error: 'no_targets' };

  const types = [];
  if (settings.sms) types.push('SMS');
  if (settings.wa) types.push('WHATSAPP');
  if (settings.miscall) types.push('MISCALL');
  if (!types.length) return { error: 'no_method' };

  const runId = db.createRun(chatId, targets.length);

  const progress = {
    runId,
    total: targets.length,
    done: 0,
    ok: 0,
    fail: 0,
    current: '',
    dirty: true,
    startedAt: Date.now(),
  };

  const msg = await sendProgressMessage(renderProgress(progress));
  const msgId = msg.message_id;

  const interval = setInterval(async () => {
    if (!progress.dirty) return;
    progress.dirty = false;
    try {
      await bot.telegram.editMessageText(chatId, msgId, undefined, renderProgress(progress), { parse_mode: 'Markdown' });
    } catch (e) {
      if (!/not modified/i.test(e.description || '')) logger.warn(`progress edit: ${e.description || e.message}`);
    }
  }, config.PROGRESS_EDIT_MS);

  const limit = pLimit(Math.max(1, settings.concurrency));

  const opts = {
    spamCount: settings.spam_count,
    delayOtp: settings.delay_otp,
    maxRetry: settings.max_retry,
    types,
  };

  try {
    await Promise.all(targets.map(t => limit(async () => {
      progress.current = t.phone;
      progress.dirty = true;
      try {
        const r = await runOne(
          { local: t.phone.replace(/^0/, ''), full: '62' + t.phone.replace(/^0/, ''), display: t.phone },
          opts,
          proxies
        );
        const ok = Object.values(r.ok).reduce((a, b) => a + b, 0);
        const fail = Object.values(r.failed).reduce((a, b) => a + b, 0);
        progress.ok += ok;
        progress.fail += fail;
        if (r.error) progress.fail += opts.spamCount * types.length;
      } catch (e) {
        logger.error(`runOne crash ${t.phone}: ${e.message}`);
        progress.fail += opts.spamCount * types.length;
      } finally {
        progress.done++;
        progress.dirty = true;
      }
    })));
  } finally {
    clearInterval(interval);
  }

  db.finishRun(runId, 'done', progress.ok, progress.fail);

  try {
    await bot.telegram.editMessageText(chatId, msgId, undefined, renderSummary(progress), { parse_mode: 'Markdown' });
  } catch (e) {
    logger.warn(`summary edit: ${e.description || e.message}`);
  }

  return { runId, ok: progress.ok, fail: progress.fail };
}

module.exports = { startRun };