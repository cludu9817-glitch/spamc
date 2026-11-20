const { Markup } = require('telegraf');
const db = require('./db');
const config = require('./config');

function renderMain(chatId) {
  const targets = db.countTargets(chatId);
  const proxies = db.countProxies(chatId);
  const text =
    '🤖 *AYO OTP BOT* — v3.0\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    `🎯 Targets: *${targets}*\n` +
    `🌐 Proxies: *${proxies}*\n` +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    'Pilih menu:';
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('🎯 Targets', 'm:targets'), Markup.button.callback('⚙️ Settings', 'm:settings')],
    [Markup.button.callback('🌐 Proxies', 'm:proxies'), Markup.button.callback('🚀 Run', 'm:run')],
    [Markup.button.callback('📊 Stats', 'm:stats'), Markup.button.callback('ℹ️ Help', 'm:help')],
  ]);
  return { text, kb };
}

function renderTargets(chatId) {
  const list = db.listTargets(chatId);
  const MAX = 30;
  let body;
  if (!list.length) {
    body = '_Belum ada target._';
  } else {
    const shown = list.slice(0, MAX).map((t, i) => `\`${String(i + 1).padStart(2, '0')}\` ${t.phone}`).join('\n');
    const more = list.length > MAX ? `\n_…dan ${list.length - MAX} nomor lainnya._` : '';
    body = shown + more;
  }
  const text = `🎯 *TARGETS* (${list.length})\n━━━━━━━━━━━━━━━━━━━━━━\n${body}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Tambah', 't:add'), Markup.button.callback('🗑 Clear All', 't:clear')],
    [Markup.button.callback('⬅️ Back', 'm:main')],
  ]);
  return { text, kb };
}

function renderSettings(chatId) {
  const s = db.getSettings(chatId);
  const flag = (v) => v ? '✅' : '❌';
  const text =
    '⚙️ *SETTINGS*\n━━━━━━━━━━━━━━━━━━━━━━\n' +
    `SMS       : ${flag(s.sms)}\n` +
    `WhatsApp  : ${flag(s.wa)}\n` +
    `Miscall   : ${flag(s.miscall)}\n` +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    `Spam count: *${s.spam_count}*x\n` +
    `Delay OTP : *${s.delay_otp}*ms\n` +
    `Delay tgt : *${s.delay_target}*ms\n` +
    `Max retry : *${s.max_retry}*\n` +
    `Concurrency: *${s.concurrency}*`;
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(`${flag(s.sms)} SMS`, 's:tg:sms'),
      Markup.button.callback(`${flag(s.wa)} WA`, 's:tg:wa'),
      Markup.button.callback(`${flag(s.miscall)} Miscall`, 's:tg:mc'),
    ],
    [
      Markup.button.callback(`✏️ Spam (${s.spam_count})`, 's:ed:sc'),
      Markup.button.callback(`✏️ Delay (${s.delay_otp})`, 's:ed:do'),
    ],
    [
      Markup.button.callback(`✏️ tgtDelay (${s.delay_target})`, 's:ed:dt'),
      Markup.button.callback(`✏️ Retry (${s.max_retry})`, 's:ed:rt'),
    ],
    [Markup.button.callback(`✏️ Concurrency (${s.concurrency})`, 's:ed:cc')],
    [Markup.button.callback('⬅️ Back', 'm:main')],
  ]);
  return { text, kb };
}

function renderProxies(chatId) {
  const list = db.listProxies(chatId);
  const MAX = 10;
  let body;
  if (!list.length) {
    body = '_Belum ada proxy. Jalan direct._';
  } else {
    const shown = list.slice(0, MAX).map((p, i) => `\`${i + 1}\` \`${maskProxy(p.url)}\``).join('\n');
    const more = list.length > MAX ? `\n_…+${list.length - MAX} lainnya._` : '';
    body = shown + more;
  }
  const text = `🌐 *PROXIES* (${list.length})\n━━━━━━━━━━━━━━━━━━━━━━\n${body}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Tambah', 'p:add'), Markup.button.callback('🗑 Clear All', 'p:clear')],
    [Markup.button.callback('⬅️ Back', 'm:main')],
  ]);
  return { text, kb };
}

function maskProxy(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || '(default)'}`;
  } catch { return url; }
}

function renderRunConfirm(chatId) {
  const s = db.getSettings(chatId);
  const targets = db.countTargets(chatId);
  const proxies = db.countProxies(chatId);
  const types = [];
  if (s.sms) types.push('SMS');
  if (s.wa) types.push('WA');
  if (s.miscall) types.push('Miscall');
  const text =
    '🚀 *KONFIRMASI RUN*\n━━━━━━━━━━━━━━━━━━━━━━\n' +
    `Targets    : *${targets}*\n` +
    `Metode     : *${types.length ? types.join(' + ') : '— (kosong)'}*\n` +
    `Spam / tgt : *${s.spam_count}*x\n` +
    `Delay OTP  : *${s.delay_otp}*ms\n` +
    `Delay tgt  : *${s.delay_target}*ms\n` +
    `Max retry  : *${s.max_retry}*\n` +
    `Concurrency: *${s.concurrency}*\n` +
    `Proxies    : *${proxies}* ${proxies ? '' : '(direct)'}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Gas', 'r:go'), Markup.button.callback('❌ Batal', 'm:main')],
  ]);
  return { text, kb };
}

function renderStats(chatId) {
  const runs = db.lastRuns(chatId, 5);
  let body = '_Belum ada run._';
  if (runs.length) {
    body = runs.map(r => {
      const dt = new Date(r.started_at).toISOString().slice(0, 16).replace('T', ' ');
      return `\`#${r.id}\` ${dt} — ${r.status} | ✅${r.total_ok} ❌${r.total_fail}/${r.total_targets}`;
    }).join('\n');
  }
  const text = `📊 *STATS* (5 terakhir)\n━━━━━━━━━━━━━━━━━━━━━━\n${body}`;
  const kb = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'm:main')]]);
  return { text, kb };
}

function renderHelp() {
  const text =
    'ℹ️ *HELP*\n━━━━━━━━━━━━━━━━━━━━━━\n' +
    '🎯 *Targets* — tambah nomor (koma/spasi/baris-baru) atau clear.\n' +
    '⚙️ *Settings* — toggle metode, ubah angka, atur concurrency.\n' +
    '🌐 *Proxies* — opsional. Format `http://user:pass@host:port`. Kalau kosong, jalan direct.\n' +
    '🚀 *Run* — konfirmasi → progress live → summary.\n' +
    '📊 *Stats* — 5 run terakhir.\n\n' +
    '_Progress pakai edit-message, bukan spam. Callback throttle 1.2s._';
  const kb = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'm:main')]]);
  return { text, kb };
}

function renderProgress(state) {
  const pct = state.total ? Math.floor((state.done / state.total) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  const cur = state.current ? state.current : '…';
  return (
    `🚀 *RUN #${state.runId}*\n` +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    `\`${bar}\` *${pct}%*\n` +
    `Progress : *${state.done}* / *${state.total}*\n` +
    `✅ OK    : *${state.ok}*\n` +
    `❌ Fail  : *${state.fail}*\n` +
    `📱 Current: \`${cur}\``
  );
}

function renderSummary(state) {
  return (
    `✅ *RUN #${state.runId} DONE*\n` +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    `Targets : *${state.total}*\n` +
    `Total OK: *${state.ok}*\n` +
    `Total ❌: *${state.fail}*\n` +
    `Duration: *${Math.round((Date.now() - state.startedAt) / 1000)}s*`
  );
}

module.exports = {
  renderMain, renderTargets, renderSettings, renderProxies,
  renderRunConfirm, renderStats, renderHelp, renderProgress, renderSummary,
};