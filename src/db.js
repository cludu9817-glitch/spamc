const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(chat_id, phone)
);
CREATE TABLE IF NOT EXISTS settings (
  chat_id INTEGER PRIMARY KEY,
  sms INTEGER NOT NULL DEFAULT 1,
  wa INTEGER NOT NULL DEFAULT 1,
  miscall INTEGER NOT NULL DEFAULT 0,
  spam_count INTEGER NOT NULL DEFAULT 5,
  delay_otp INTEGER NOT NULL DEFAULT 3000,
  delay_target INTEGER NOT NULL DEFAULT 2000,
  max_retry INTEGER NOT NULL DEFAULT 3,
  concurrency INTEGER NOT NULL DEFAULT 3
);
CREATE TABLE IF NOT EXISTS proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(chat_id, url)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_targets INTEGER NOT NULL DEFAULT 0,
  total_ok INTEGER NOT NULL DEFAULT 0,
  total_fail INTEGER NOT NULL DEFAULT 0
);
`);

function getSettings(chatId) {
  let row = db.prepare('SELECT * FROM settings WHERE chat_id = ?').get(chatId);
  if (row) return row;
  db.prepare('INSERT INTO settings (chat_id) VALUES (?)').run(chatId);
  return db.prepare('SELECT * FROM settings WHERE chat_id = ?').get(chatId);
}

function updateSettings(chatId, patch) {
  getSettings(chatId);
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const set = cols.map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE settings SET ${set} WHERE chat_id = @chat_id`)
    .run({ chat_id: chatId, ...patch });
}

function addTargets(chatId, phones) {
  const stmt = db.prepare('INSERT OR IGNORE INTO targets (chat_id, phone, added_at) VALUES (?, ?, ?)');
  const tx = db.transaction((arr) => {
    let n = 0;
    for (const p of arr) n += stmt.run(chatId, p, Date.now()).changes;
    return n;
  });
  return tx(phones);
}

function listTargets(chatId) {
  return db.prepare('SELECT * FROM targets WHERE chat_id = ? ORDER BY id').all(chatId);
}

function countTargets(chatId) {
  return db.prepare('SELECT COUNT(*) AS n FROM targets WHERE chat_id = ?').get(chatId).n;
}

function clearTargets(chatId) {
  return db.prepare('DELETE FROM targets WHERE chat_id = ?').run(chatId).changes;
}

function addProxies(chatId, urls) {
  const stmt = db.prepare('INSERT OR IGNORE INTO proxies (chat_id, url, added_at) VALUES (?, ?, ?)');
  const tx = db.transaction((arr) => {
    let n = 0;
    for (const u of arr) n += stmt.run(chatId, u, Date.now()).changes;
    return n;
  });
  return tx(urls);
}

function listProxies(chatId) {
  return db.prepare('SELECT * FROM proxies WHERE chat_id = ? ORDER BY id').all(chatId);
}

function countProxies(chatId) {
  return db.prepare('SELECT COUNT(*) AS n FROM proxies WHERE chat_id = ?').get(chatId).n;
}

function clearProxies(chatId) {
  return db.prepare('DELETE FROM proxies WHERE chat_id = ?').run(chatId).changes;
}

function createRun(chatId, totalTargets) {
  const info = db.prepare('INSERT INTO runs (chat_id, status, started_at, total_targets) VALUES (?, ?, ?, ?)')
    .run(chatId, 'running', Date.now(), totalTargets);
  return info.lastInsertRowid;
}

function finishRun(runId, status, ok, fail) {
  db.prepare('UPDATE runs SET status = ?, ended_at = ?, total_ok = ?, total_fail = ? WHERE id = ?')
    .run(status, Date.now(), ok, fail, runId);
}

function lastRuns(chatId, limit = 5) {
  return db.prepare('SELECT * FROM runs WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
    .all(chatId, limit);
}

module.exports = {
  db,
  getSettings, updateSettings,
  addTargets, listTargets, countTargets, clearTargets,
  addProxies, listProxies, countProxies, clearProxies,
  createRun, finishRun, lastRuns,
};