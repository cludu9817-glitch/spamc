const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { normalizePhone } = require('./ayo');
const { startRun } = require('./actions');
const ui = require('./ui');

const state = new Map();
const lastMenuMsg = new Map();
const lastCb = new Map();

const bot = new Telegraf(config.BOT_TOKEN, { handlerTimeout: 180_000 });

bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!config.ADMIN_IDS.includes(uid)) {
    if (ctx.callbackQuery) return ctx.answerCbQuery('⛔ Not authorized', { show_alert: true });
    if (ctx.message) return ctx.reply('⛔ Not authorized').catch(() => {});
    return;
  }
  if (ctx.callbackQuery) {
    const cid = ctx.chat.id;
    const now = Date.now();
    if ((lastCb.get(cid) || 0) + config.CALLBACK_THROTTLE_MS > now) {
      return ctx.answerCbQuery('⏳ slow down');
    }
    lastCb.set(cid, now);
  }
  return next();
});

async function renderMenu(ctx, render) {
  const { text, kb } = render(ctx.chat.id);
  const existing = lastMenuMsg.get(ctx.chat.id);
  try {
    if (existing) {
      await ctx.telegram.editMessageText(ctx.chat.id, existing, undefined, text, { parse_mode: 'Markdown', ...kb });
      return;
    }
  } catch (e) {
    if (!/not modified/i.test(e.description || '')) lastMenuMsg.delete(ctx.chat.id);
  }
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  lastMenuMsg.set(ctx.chat.id, msg.message_id);
}

async function editMenu(ctx, render) {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await renderMenu(ctx, render);
}

function askInput(ctx, action, promptText, render) {
  state.set(ctx.chat.id, { action });
  const { kb } = render(ctx.chat.id);
  return ctx.reply(promptText, { parse_mode: 'Markdown', ...kb });
}

bot.start(async (ctx) => {
  state.delete(ctx.chat.id);
  lastMenuMsg.delete(ctx.chat.id);
  const { text, kb } = ui.renderMain(ctx.chat.id);
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  lastMenuMsg.set(ctx.chat.id, msg.message_id);
});

bot.command('menu', async (ctx) => {
  state.delete(ctx.chat.id);
  lastMenuMsg.delete(ctx.chat.id);
  await renderMenu(ctx, ui.renderMain);
});

bot.action('m:main', (ctx) => editMenu(ctx, ui.renderMain));
bot.action('m:targets', (ctx) => editMenu(ctx, ui.renderTargets));
bot.action('m:settings', (ctx) => editMenu(ctx, ui.renderSettings));
bot.action('m:proxies', (ctx) => editMenu(ctx, ui.renderProxies));
bot.action('m:stats', (ctx) => editMenu(ctx, ui.renderStats));
bot.action('m:help', (ctx) => editMenu(ctx, ui.renderHelp));

bot.action('m:run', async (ctx) => {
  const targets = db.countTargets(ctx.chat.id);
  const s = db.getSettings(ctx.chat.id);
  if (!targets) {
    await ctx.answerCbQuery();
    return renderMenu(ctx, ui.renderTargets);
  }
  if (!s.sms && !s.wa && !s.miscall) {
    await ctx.answerCbQuery('Metode kosong', { show_alert: true });
    return renderMenu(ctx, ui.renderSettings);
  }
  await editMenu(ctx, ui.renderRunConfirm);
});

bot.action('r:go', async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = ctx.chat.id;
  lastMenuMsg.delete(chatId);
  try { await ctx.editMessageReplyMarkup(undefined); } catch {}

  await startRun(bot, chatId, async (text) => {
    return ctx.reply(text, { parse_mode: 'Markdown' });
  });

  const { text, kb } = ui.renderMain(chatId);
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  lastMenuMsg.set(chatId, msg.message_id);
});

bot.action('t:add', (ctx) => {
  state.set(ctx.chat.id, { action: 'add_targets' });
  return ctx.reply(
    '📱 Kirim daftar nomor.\nFormat: pisah koma / spasi / baris baru.\nContoh:\n`085763715052, 08123456789`',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 't:add_cancel')]]) }
  );
});

bot.action('t:add_cancel', async (ctx) => {
  state.delete(ctx.chat.id);
  await ctx.answerCbQuery('batal');
  await editMenu(ctx, ui.renderTargets);
});

bot.action('t:clear', async (ctx) => {
  const n = db.clearTargets(ctx.chat.id);
  await ctx.answerCbQuery(`cleared ${n}`);
  await editMenu(ctx, ui.renderTargets);
});

bot.action('p:add', (ctx) => {
  state.set(ctx.chat.id, { action: 'add_proxies' });
  return ctx.reply(
    '🌐 Kirim daftar proxy (1 per baris).\nFormat: `http://user:pass@host:port` atau `http://host:port`',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 'p:add_cancel')]]) }
  );
});

bot.action('p:add_cancel', async (ctx) => {
  state.delete(ctx.chat.id);
  await ctx.answerCbQuery('batal');
  await editMenu(ctx, ui.renderProxies);
});

bot.action('p:clear', async (ctx) => {
  const n = db.clearProxies(ctx.chat.id);
  await ctx.answerCbQuery(`cleared ${n}`);
  await editMenu(ctx, ui.renderProxies);
});

bot.action('s:tg:sms', async (ctx) => {
  const s = db.getSettings(ctx.chat.id);
  db.updateSettings(ctx.chat.id, { sms: s.sms ? 0 : 1 });
  await ctx.answerCbQuery();
  await editMenu(ctx, ui.renderSettings);
});

bot.action('s:tg:wa', async (ctx) => {
  const s = db.getSettings(ctx.chat.id);
  db.updateSettings(ctx.chat.id, { wa: s.wa ? 0 : 1 });
  await ctx.answerCbQuery();
  await editMenu(ctx, ui.renderSettings);
});

bot.action('s:tg:mc', async (ctx) => {
  const s = db.getSettings(ctx.chat.id);
  db.updateSettings(ctx.chat.id, { miscall: s.miscall ? 0 : 1 });
  await ctx.answerCbQuery();
  await editMenu(ctx, ui.renderSettings);
});

const numPrompts = {
  's:ed:sc': { key: 'spam_count', min: 1, max: 50, label: 'spam count (1–50)' },
  's:ed:do': { key: 'delay_otp', min: 500, max: 120_000, label: 'delay OTP ms (500–120000)' },
  's:ed:dt': { key: 'delay_target', min: 0, max: 120_000, label: 'delay antar target ms (0–120000)' },
  's:ed:rt': { key: 'max_retry', min: 0, max: 10, label: 'max retry (0–10)' },
  's:ed:cc': { key: 'concurrency', min: 1, max: 10, label: 'concurrency (1–10)' },
};

for (const [action, spec] of Object.entries(numPrompts)) {
  bot.action(action, (ctx) => {
    state.set(ctx.chat.id, { action: 'edit_num', key: spec.key, min: spec.min, max: spec.max });
    return ctx.reply(`✏️ Masukkan ${spec.label}:`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batal', 's:edit_cancel')]]),
    });
  });
}

bot.action('s:edit_cancel', async (ctx) => {
  state.delete(ctx.chat.id);
  await ctx.answerCbQuery('batal');
  await editMenu(ctx, ui.renderSettings);
});

bot.on('text', async (ctx) => {
  const s = state.get(ctx.chat.id);
  if (!s) return;
  const text = ctx.message.text;

  if (s.action === 'add_targets') {
    const lines = text.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    const phones = [];
    let invalid = 0;
    for (const raw of lines) {
      const n = normalizePhone(raw);
      if (n) phones.push(n.display);
      else invalid++;
    }
    const added = phones.length ? db.addTargets(ctx.chat.id, phones) : 0;
    state.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await renderMenu(ctx, ui.renderTargets);
    await ctx.reply(`✅ Ditambah: *${added}*\n⚠️ Invalid: *${invalid}*`, { parse_mode: 'Markdown' });
    return;
  }

  if (s.action === 'add_proxies') {
    const lines = text.split(/\s+/).map(t => t.trim()).filter(Boolean);
    const valid = lines.filter(u => {
      try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; }
      catch { return false; }
    });
    const added = valid.length ? db.addProxies(ctx.chat.id, valid) : 0;
    state.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await renderMenu(ctx, ui.renderProxies);
    await ctx.reply(`✅ Ditambah: *${added}*\n⚠️ Invalid: *${lines.length - valid.length}*`, { parse_mode: 'Markdown' });
    return;
  }

  if (s.action === 'edit_num') {
    const n = parseInt(text.trim(), 10);
    if (!Number.isFinite(n) || n < s.min || n > s.max) {
      await ctx.reply(`❌ Angka invalid. Range: ${s.min}–${s.max}. Coba lagi.`);
      return;
    }
    db.updateSettings(ctx.chat.id, { [s.key]: n });
    state.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await renderMenu(ctx, ui.renderSettings);
    return;
  }
});

bot.catch((err, ctx) => {
  logger.error(`bot error ${ctx?.updateType}: ${err.message}`);
});

module.exports = bot;