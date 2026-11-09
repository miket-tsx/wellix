import { config } from '../config.js';
import { guildCfg, saveGuild } from './db.js';
import { COLOR, embed } from './render.js';
import { send } from './cv2.js';
import { truncate } from './util.js';

export function casesOf(guildId) {
  return guildCfg(guildId).cases;
}

export function findCase(guildId, id) {
  return casesOf(guildId).find((c) => c.id === Number(id));
}

export function warnCount(guildId, userId) {
  return casesOf(guildId).filter((c) => c.type === 'warn' && c.targetId === userId).length;
}

export function removeCases(guildId, pred) {
  const cfg = guildCfg(guildId);
  const before = cfg.cases.length;
  cfg.cases = cfg.cases.filter((c) => !pred(c));
  saveGuild(guildId, cfg);
  return before - cfg.cases.length;
}

export async function addCase(guild, entry) {
  const cfg = guildCfg(guild.id);
  const rec = {
    id: ++cfg.casesSeq,
    type: entry.type,
    targetId: entry.targetId ?? null,
    targetTag: entry.targetTag ?? null,
    moderatorId: entry.moderatorId ?? null,
    reason: entry.reason || 'No reason given',
    duration: entry.duration ?? null,
    at: Date.now(),
    ...(entry.extra || {}),
  };

  cfg.cases.unshift(rec);
  if (cfg.cases.length > 5000) cfg.cases.length = 5000;
  saveGuild(guild.id, cfg);

  postLog(guild, rec);
  return rec;
}

function postLog(guild, rec) {
  const channelId = guildCfg(guild.id).modlog || config.modlog;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const target = rec.targetId ? `<@${rec.targetId}> \`${rec.targetId}\`` : 'n/a';
  send(channel, {
    embeds: [
      embed({
        title: `case #${rec.id} · ${rec.type}`,
        color: COLOR.mod,
        fields: [
          { name: 'target', value: target, inline: true },
          { name: 'moderator', value: rec.moderatorId ? `<@${rec.moderatorId}>` : 'system', inline: true },
          { name: 'reason', value: truncate(rec.reason, 500) },
          ...(rec.duration ? [{ name: 'duration', value: rec.duration, inline: true }] : []),
        ],
        footer: `guild ${guild.id}`,
      }),
    ],
  }).catch(() => {});
}
