import { guildCfg, saveGuild } from '../lib/db.js';
import { applyVars, COLOR, embed } from '../lib/render.js';
import { dm, reply, send } from '../lib/cv2.js';
import { truncate } from '../lib/util.js';

const TYPES = new Set(['send', 'reply', 'dm', 'addRole', 'removeRole', 'delete', 'log', 'embed']);

export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') return 'spec must be an object';
  if (!['message', 'join', 'leave'].includes(spec.on)) return 'on must be message, join or leave';
  if (!Array.isArray(spec.actions) || !spec.actions.length) return 'actions must be a non-empty array';
  if (spec.actions.length > 12) return 'that is too many actions (max 12)';

  for (const action of spec.actions) {
    if (!action || !TYPES.has(action.type)) return `unknown action: ${action?.type}`;
    if (['send', 'reply', 'dm', 'log', 'embed'].includes(action.type) && !action.content && !action.title) {
      return `action ${action.type} needs content`;
    }
  }

  if (spec.on === 'message' && !spec.match?.contains && !spec.match?.regex) {
    return 'message features need match.contains or match.regex';
  }

  return null;
}

function findChannel(guild, ref) {
  if (!ref) return null;
  const key = String(ref).replace(/^#/, '').toLowerCase();
  return guild.channels.cache.get(ref) || guild.channels.cache.find((c) => c.name.toLowerCase() === key) || null;
}

function findRole(guild, ref) {
  if (!ref) return null;
  const key = String(ref).replace(/^@/, '').toLowerCase();
  return guild.roles.cache.get(ref) || guild.roles.cache.find((r) => r.name.toLowerCase() === key) || null;
}

function matches(spec, message) {
  const m = spec.match || {};
  const content = message.content.toLowerCase();

  if (m.contains && !content.includes(String(m.contains).toLowerCase())) return false;
  if (m.regex) {
    try {
      if (!new RegExp(m.regex, 'i').test(message.content)) return false;
    } catch {
      return false;
    }
  }
  if (m.channel) {
    const c = findChannel(message.guild, m.channel);
    if (!c || c.id !== message.channel.id) return false;
  }
  if (m.role) {
    const r = findRole(message.guild, m.role);
    if (!r || !message.member?.roles.cache.has(r.id)) return false;
  }
  return true;
}

export async function runSpec(guild, spec, context = {}) {
  const user = context.member?.user || context.message?.author;
  const vars = { user, guild, count: guild.memberCount };
  const done = [];

  for (const action of spec.actions) {
    const text = truncate(applyVars(action.content || '', vars), 2000);

    switch (action.type) {
      case 'send': {
        const target = findChannel(guild, action.channel) || context.message?.channel;
        if (target?.isTextBased()) {
          await send(target, { content: text }).catch(() => {});
          done.push('send');
        }
        break;
      }
      case 'reply': {
        if (context.message) await reply(context.message, { content: text, allowedMentions: { repliedUser: false } }).catch(() => {});
        done.push('reply');
        break;
      }
      case 'dm': {
        if (user) await dm(user, text).catch(() => {});
        done.push('dm');
        break;
      }
      case 'addRole':
      case 'removeRole': {
        const role = findRole(guild, action.role);
        if (role && context.member) {
          await (action.type === 'addRole' ? context.member.roles.add(role) : context.member.roles.remove(role)).catch(() => {});
          done.push(action.type);
        }
        break;
      }
      case 'delete': {
        if (context.message) await context.message.delete().catch(() => {});
        done.push('delete');
        break;
      }
      case 'log': {
        const channel = findChannel(guild, action.channel) || guild.channels.cache.get(guildCfg(guild.id).modlog);
        if (channel?.isTextBased()) await send(channel, { content: text || 'feature fired' }).catch(() => {});
        done.push('log');
        break;
      }
      case 'embed': {
        const target = findChannel(guild, action.channel) || context.message?.channel;
        if (target?.isTextBased()) {
          await send(target, { embeds: [embed({ title: action.title || spec.name, description: text, color: COLOR.info })] }).catch(
            () => {},
          );
          done.push('embed');
        }
        break;
      }
      default:
        break;
    }
  }

  return done;
}

export function addFeature(guildId, spec) {
  const problem = validateSpec(spec);
  if (problem) return { error: problem };

  const cfg = guildCfg(guildId);
  const id =
    spec.id ||
    String(spec.name || 'feature')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) ||
    `f${Date.now()}`;

  const feature = {
    id,
    name: spec.name || id,
    enabled: spec.enabled !== false,
    on: spec.on,
    match: spec.match || {},
    actions: spec.actions,
    createdAt: Date.now(),
  };

  cfg.features = (cfg.features || []).filter((f) => f.id !== id);
  cfg.features.push(feature);
  saveGuild(guildId, cfg);
  return { feature };
}

export function removeFeature(guildId, ref) {
  const cfg = guildCfg(guildId);
  const before = cfg.features.length;
  cfg.features = cfg.features.filter((f) => f.id !== ref && f.name !== ref);
  saveGuild(guildId, cfg);
  return before !== cfg.features.length;
}

export function toggleFeature(guildId, ref, enabled) {
  const cfg = guildCfg(guildId);
  const feature = cfg.features.find((f) => f.id === ref || f.name === ref);
  if (!feature) return null;
  feature.enabled = enabled;
  saveGuild(guildId, cfg);
  return feature;
}

export function listFeatures(guildId) {
  return guildCfg(guildId).features;
}

export function findFeature(guildId, ref) {
  return guildCfg(guildId).features.find((f) => f.id === ref || f.name === ref) || null;
}

export async function runMessageFeatures(message) {
  const features = guildCfg(message.guild.id).features;
  let ran = 0;
  for (const f of features) {
    if (!f.enabled || f.on !== 'message') continue;
    if (!matches(f, message)) continue;
    await runSpec(message.guild, f, { message }).catch((e) => console.error('feature', f.id, e.message));
    ran++;
  }
  return ran;
}

export async function runJoinFeatures(member) {
  const features = guildCfg(member.guild.id).features;
  for (const f of features) {
    if (f.enabled && f.on === 'join') {
      await runSpec(member.guild, f, { member }).catch(() => {});
    }
  }
}

export async function runLeaveFeatures(member) {
  const features = guildCfg(member.guild.id).features;
  for (const f of features) {
    if (f.enabled && f.on === 'leave') {
      await runSpec(member.guild, f, { member }).catch(() => {});
    }
  }
}
