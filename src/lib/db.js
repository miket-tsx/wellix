import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const FILE = path.join(config.dataDir, 'wellix.json');

let data = {};
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  data = {};
}

let pending = null;
export function save() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    flush();
  }, 300);
}

export function flush() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('store write failed:', err.message);
  }
}

export const db = {
  get(key, fallback = null) {
    return data[key] === undefined ? fallback : data[key];
  },
  set(key, value) {
    data[key] = value;
    save();
  },
  remove(key) {
    delete data[key];
    save();
  },
  all() {
    return data;
  },
};

const DEFAULTS = {
  prefix: null, // falls back to config.prefix
  modlog: null,
  casesSeq: 0,
  cases: [],
  roleBackups: {},
  welcome: {
    enabled: false,
    channel: null,
    message: 'Welcome to **{server}**, {user}! You are member #{count}.',
    embed: false,
    dm: null,
    image: null,
  },
  goodbye: {
    enabled: false,
    channel: null,
    message: '**{name}** left the server.',
  },
  tickets: {
    counter: 0,
    category: null,
    log: null,
    supportRole: null,
    panelChannel: null,
    open: {},
    topic: 'Need help? Open a ticket and staff will be with you shortly.',
  },
  automod: {
    antispam: true,
    antilink: false,
    antiinvite: true,
    badwords: [],
    warnThreshold: 3,
    exempt: [],
    presets: {},
  },
  autoroles: [],
  autoresponders: [],
  autoreact: [],
  reactionRoles: [],
  ai: {
    enabled: true,
    persona: '',
  },
  features: [],
  settings: {
    locale: 'en',
    timezone: 'UTC',
    theme: '#8b5cf6',
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, extra) {
  const out = structuredClone(base);
  if (!isObj(extra)) return out;
  for (const [k, v] of Object.entries(extra)) {
    out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

export function guildCfg(guildId) {
  const guilds = (data.guilds ??= {});
  guilds[guildId] ??= {};
  const merged = merge(DEFAULTS, guilds[guildId]);
  guilds[guildId] = merged;
  return merged;
}

// writes the mutation back - call after editing the object returned by guildCfg
export function saveGuild(guildId, cfg) {
  const guilds = (data.guilds ??= {});
  guilds[guildId] = cfg;
  save();
}

export function prefixFor(guildId) {
  const cfg = guildCfg(guildId);
  return cfg.prefix || config.prefix;
}
