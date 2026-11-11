import 'dotenv/config';
import path from 'node:path';

const int = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function providerKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`${prefix}_KEY_${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  owners: csv(process.env.OWNER_IDS),
  prefix: process.env.PREFIX || 'w!',
  modlog: process.env.MODLOG_CHANNEL_ID || '',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),

  ai: {
    providers: [],
    steps: int(process.env.AI_MAX_STEPS, 8),
    temperature: num(process.env.AI_TEMPERATURE, 0.7),
    maxTokens: int(process.env.AI_MAX_TOKENS, 3000),
    allowDestructive: process.env.AI_ALLOW_DESTRUCTIVE !== 'false',
  },

  selfbuild: process.env.SELFBUILD === 'true',
};

// Build provider list from env. Each provider can have up to 10 keys.
function buildProviders() {
  const providers = csv(process.env.AI_PROVIDERS);
  const list = [];

  for (const name of providers) {
    const upper = name.toUpperCase();
    const keys = providerKeys(`AI_${upper}`);
    if (!keys.length) continue;
    list.push({
      name,
      baseUrl: process.env[`AI_${upper}_BASE_URL`] || 'https://api.openai.com/v1',
      model: process.env[`AI_${upper}_MODEL`] || 'gpt-4o-mini',
      keys,
    });
  }

  // Legacy single-key support (AI_API_KEY / AI_BASE_URL / AI_MODEL)
  if (!list.length && process.env.AI_API_KEY) {
    list.push({
      name: 'legacy',
      baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      keys: [process.env.AI_API_KEY],
    });
  }

  return list;
}

config.ai.providers = buildProviders();

if (!config.token) {
  console.error('DISCORD_TOKEN is missing. copy .env.example and fill it in.');
  process.exit(1);
}
