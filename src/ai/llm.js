import { config } from '../config.js';

export function aiReady() {
  return Boolean(config.ai.key);
}

async function request(messages, opts, withJson) {
  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.ai.key}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
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
    throw err;
  }

  return res;
}

export async function chat(messages, opts = {}) {
  if (!aiReady()) throw new Error('AI is not configured (AI_API_KEY missing)');

  let res;
  try {
    res = await request(messages, opts, opts.json !== false);
  } catch (err) {
    // some providers reject response_format outright. retry plain once.
    if (err.status !== 400) throw err;
    res = await request(messages, opts, false);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty completion');
  return content;
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
