import { PermissionsBitField } from 'discord.js';
import { COLOR } from '../lib/render.js';
import { truncate } from '../lib/util.js';

// ---------------------------------------------------------------------------
// shared command helpers
// every command module may import from here, nothing here imports a command.
// ---------------------------------------------------------------------------

export const DAY = 86_400_000;
export const MAX_TIMEOUT = 28 * DAY;

export const tagOf = (u) => u?.tag || u?.username || String(u?.id ?? 'unknown');

export function stamp(ms, style = 'F') {
  if (!ms && ms !== 0) return '—';
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

export function yes(value) {
  return value === true || /^(true|yes|on|1|y)$/i.test(String(value));
}

export async function getMember(guild, user) {
  if (!user) return null;
  if (user.guildId === guild.id) return user;
  return guild.members.fetch(user.id).catch(() => null);
}

export async function getBan(guild, id) {
  if (!id) return null;
  return guild.bans.fetch(String(id)).catch(() => null);
}

export const botMember = (guild) => guild.members.me;
export const highest = (member) => member?.roles?.highest?.position ?? 0;

// true when the bot outranks the target and is allowed to act on them.
export function canActOn(guild, target) {
  const me = botMember(guild);
  if (!target || !me) return false;
  if (target.id === guild.ownerId || target.id === me.id) return false;
  return highest(me) > highest(target);
}

// true when the role sits below the bot and is not managed/@everyone.
export function canManageRole(guild, role) {
  const me = botMember(guild);
  if (!role || !me || role.id === guild.id || role.managed) return false;
  return role.position < highest(me);
}

export function botPerms(guild, channel) {
  const me = botMember(guild);
  if (!me) return null;
  return channel?.permissionsFor ? channel.permissionsFor(me) : me.permissions;
}

export function missingBotPerms(guild, channel, perms = []) {
  const set = botPerms(guild, channel);
  if (!set) return perms;
  return perms.filter((name) => !set.has(PermissionsBitField.Flags[name]));
}

export function missingMemberPerms(member, perms = []) {
  if (!member) return perms;
  return perms.filter((name) => !member.permissions.has(PermissionsBitField.Flags[name]));
}

// a consistent audit-log reason: "moderator: reason"
export function reasonFor(user, text, fallback = 'no reason') {
  return `${tagOf(user)}: ${text || fallback}`.slice(0, 512);
}

export function hexColor(input) {
  if (input == null) return undefined;
  const s = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]{3}$/i.test(s)) return parseInt(s.split('').map((c) => c + c).join(''), 16);
  return undefined;
}

export function listBody(lines, empty = 'nothing to show') {
  if (!lines?.length) return empty;
  return lines.join('\n');
}

// split a long list into pages and return the requested page.
export function page(list, number = 1, size = 15) {
  const total = Math.max(1, Math.ceil(list.length / size));
  const index = Math.min(Math.max(1, Number(number) || 1), total);
  return {
    total,
    index,
    items: list.slice((index - 1) * size, index * size),
  };
}

export function caseLine(c) {
  return `#${c.id} \`${c.type}\` · ${truncate(c.reason, 70)}`;
}

export function caseFooter(pageInfo) {
  return pageInfo ? `-# page ${pageInfo.index}/${pageInfo.total}` : '';
}

export function colorFor(kind) {
  return COLOR[kind] ?? COLOR.info;
}

// turn a duration string into a bounded ms value. returns { ms, error }.
export function boundedDuration(input, { min = 60_000, max = MAX_TIMEOUT, fallback = null } = {}) {
  const raw = input == null ? fallback : input;
  if (raw == null) return { error: 'give me a duration, like `10m` or `2d`' };
  const ms = typeof raw === 'number' ? raw : parseDurationLoose(raw);
  if (!ms) return { error: 'that duration did not parse. try `30m`, `6h`, `7d`.' };
  if (ms < min) return { error: `minimum is ${humanMs(min)}.` };
  if (ms > max) return { error: `maximum is ${humanMs(max)}.` };
  return { ms };
}

function parseDurationLoose(input) {
  const s = String(input).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s) * 60_000;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000 };
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(mo|min|ms|s|m|h|d|w|y)/g;
  let hit;
  while ((hit = re.exec(s))) {
    const unitKey = hit[2] === 'min' ? 'm' : hit[2];
    total += Number(hit[1]) * (unit[unitKey] || 0);
  }
  return Math.round(total);
}

function humanMs(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
