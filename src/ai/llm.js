import { config } from '../config.js';

// A key that hits auth/rate-limit/server errors is cooled off for this long.
const FAIL_WINDOW = 10 * 60 * 1000;
const failedKeys = new Map(); // key -> failure timestamp

function isKeyFailed(key) {
  const ts = failedKeys.get(key);
  if (!ts) return false;
  if (Date.now() - ts > FAIL_WINDOW) {
    failedKeys.delete(key);
    return false;
  }
  return true;
}

function markKeyFailed(key) {
  failedKeys.set(key, Date.now());
}

export function aiReady() {
  return config.ai.providers.some((p) => p.keys.some((k) => !isKeyFailed(k)));
}

function chatUrl(provider) {
  return provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

async function request(provider, key, messages, opts, withJson) {
  const res = await fetch(chatUrl(provider), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: opts.temperature ?? config.ai.temperature,
      max_tokens: opts.maxTokens ?? config.ai.maxTokens,
      ...(withJson ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeout ?? 60000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`AI ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    err.key = key;
    err.provider = provider.name;
    throw err;
  }

  return res;
}

async function tryKey(provider, key, messages, opts) {
  // First attempt with JSON mode (some providers reject it).
  try {
    const res = await request(provider, key, messages, opts, opts.json !== false);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty completion');
    return content;
  } catch (err) {
    if (err.status !== 400) throw err;
    // Retry once without response_format.
    const res = await request(provider, key, messages, opts, false);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty completion');
    return content;
  }
}

export async function chat(messages, opts = {}) {
  const providers = config.ai.providers;
  if (!providers.length) {
    throw new Error('AI is not configured. Set AI_PROVIDERS and AI_*_KEY_1..10 in .env.');
  }

  let lastErr;

  // Walk providers in order, then keys within each provider.
  // Failed keys are skipped and cooled off automatically.
  for (const provider of providers) {
    const usableKeys = provider.keys.filter((k) => !isKeyFailed(k));
    if (!usableKeys.length) continue;

    for (const key of usableKeys) {
      try {
        return await tryKey(provider, key, messages, opts);
      } catch (err) {
        lastErr = err;
        if (
          err.status === 401 ||
          err.status === 403 ||
          err.status === 429 ||
          err.status >= 500
        ) {
          markKeyFailed(key);
        }
      }
    }
  }

  throw lastErr || new Error('All AI providers and keys failed.');
}

// models love wrapping json in prose or fences. dig out the first balanced object.
export function extractJson(text) {
  if (!text) return null;
  let body = String(text).trim();
  body = body.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(body);
  } catch {
    /* scanner below */
  }

  const start = body.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i++) {
    const c = body[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
