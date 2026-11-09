import { guildCfg } from '../lib/db.js';
import { COLOR, embed } from '../lib/render.js';
import { reply, send } from '../lib/cv2.js';
import { escapeRegex, truncate } from '../lib/util.js';

const buckets = new Map();
const LINK = /(https?:\/\/|www\.)\S+/i;
const INVITE = /(discord\.(gg|com\/invite|me)\/[\w-]+)/i;

function log(trigger, message, detail) {
  const cfg = guildCfg(message.guild.id);
  const id = cfg.modlog;
  if (!id) return;
  const channel = message.guild.channels.cache.get(id);
  if (!channel) return;

  send(channel, {
    embeds: [
      embed({
        title: `automod · ${trigger}`,
        color: COLOR.warn,
        fields: [
          { name: 'user', value: `${message.author} \`${message.author.id}\``, inline: true },
          { name: 'channel', value: `${message.channel}`, inline: true },
          { name: 'detail', value: truncate(detail || '—', 400) },
          { name: 'message', value: truncate(message.content || '*empty*', 700) },
        ],
      }),
    ],
  }).catch(() => {});
}

async function punish(message, trigger, detail) {
  await message.delete().catch(() => {});
  if (message.member?.moderatable) {
    await message.member.timeout(60000, `automod: ${trigger}`).catch(() => {});
  }
  const warn = await send(message.channel, {
    embeds: [embed({ description: `${message.author}, that was filtered: ${trigger}.`, color: COLOR.warn })],
  }).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000);
  log(trigger, message, detail);
  return true;
}

export async function check(message) {
  if (!message.inGuild() || message.author.bot) return false;
  if (message.member?.permissions.has('ManageMessages')) return false;

  const cfg = guildCfg(message.guild.id);
  const am = cfg.automod;
  const content = message.content || '';

  if (am.antispam) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const recent = (buckets.get(key) || []).filter((t) => now - t < 6000);
    recent.push(now);
    buckets.set(key, recent);

    if (recent.length >= 6) {
      buckets.delete(key);
      return punish(message, 'spam', '6 messages within 6 seconds');
    }
  }

  if (am.antiinvite && INVITE.test(content)) {
    return punish(message, 'invite', 'discord invite link');
  }

  if (am.antilink && LINK.test(content) && !content.includes('tenor.com') && !content.includes('giphy.com')) {
    return punish(message, 'link', 'external link');
  }

  if (am.badwords?.length) {
    const lower = content.toLowerCase();
    const hit = am.badwords.find((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(lower));
    if (hit) return punish(message, 'bad word', hit);
  }

  if (content.length > 40 && content.replace(/[^A-Z]/g, '').length / content.replace(/[^A-Za-z]/g, '').length > 0.75) {
    return punish(message, 'caps', 'mostly uppercase');
  }

  return false;
}

export async function runAutoreact(message) {
  if (!message.inGuild() || message.author.bot) return;
  const cfg = guildCfg(message.guild.id);
  for (const rule of cfg.autoreact || []) {
    if (message.content.toLowerCase().includes(rule.trigger)) {
      await message.react(rule.emoji).catch(() => {});
    }
  }
}

export async function runAutoresponder(message) {
  if (!message.inGuild() || message.author.bot) return;
  const cfg = guildCfg(message.guild.id);
  for (const rule of cfg.autoresponders || []) {
    if (message.content.toLowerCase().includes(rule.trigger)) {
      await reply(message, { content: truncate(rule.response, 1900), allowedMentions: { repliedUser: false } }).catch(() => {});
      return;
    }
  }
}
