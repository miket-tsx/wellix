import { guildCfg } from '../lib/db.js';
import { applyVars, COLOR, embed } from '../lib/render.js';
import { dm, send } from '../lib/cv2.js';
import { truncate } from '../lib/util.js';

export async function onJoin(member) {
  const cfg = guildCfg(member.guild.id);

  for (const roleId of cfg.autoroles || []) {
    const role = member.guild.roles.cache.get(roleId);
    if (role?.editable) await member.roles.add(role, 'autorole').catch(() => {});
  }

  const vars = { user: member.user, guild: member.guild, count: member.guild.memberCount };

  if (cfg.welcome.dm) {
    dm(member, truncate(applyVars(cfg.welcome.dm, vars), 2000)).catch(() => {});
  }

  if (!cfg.welcome.enabled || !cfg.welcome.channel) return;
  const channel = member.guild.channels.cache.get(cfg.welcome.channel);
  if (!channel?.isTextBased()) return;

  const text = truncate(applyVars(cfg.welcome.message, vars), 2000);
  const payload = cfg.welcome.embed
    ? { embeds: [embed({ description: text, color: COLOR.info, thumb: member.displayAvatarURL({ size: 128 }), image: cfg.welcome.image || undefined })] }
    : { content: text };

  await send(channel, payload).catch(() => {});
}

export async function onLeave(member) {
  const cfg = guildCfg(member.guild.id);
  if (!cfg.goodbye.enabled || !cfg.goodbye.channel) return;

  const channel = member.guild.channels.cache.get(cfg.goodbye.channel);
  if (!channel?.isTextBased()) return;

  const text = truncate(applyVars(cfg.goodbye.message, { user: member.user, guild: member.guild }), 2000);
  await send(channel, { content: text }).catch(() => {});
}
