import 'dotenv/config';
import path from 'node:path';

const int = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  owners: csv(process.env.OWNER_IDS),
  prefix: process.env.PREFIX || 'w!',
  modlog: process.env.MODLOG_CHANNEL_ID || '',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),

  ai: {
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    key: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    steps: int(process.env.AI_MAX_STEPS, 8),
    temperature: int(process.env.AI_TEMPERATURE, 0.4),
    maxTokens: int(process.env.AI_MAX_TOKENS, 3000),
  },

  selfbuild: process.env.SELFBUILD === 'true',
  allowDestructive: process.env.AI_ALLOW_DESTRUCTIVE !== 'false',
};

if (!config.token) {
  console.error('DISCORD_TOKEN is missing. copy .env.example and fill it in.');
  process.exit(1);
}
