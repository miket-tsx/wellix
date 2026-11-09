import { ChannelType } from 'discord.js';
import { resolveChannel, resolveMember, resolveRole } from '../../lib/resolvers.js';

export async function needChannel(guild, ref) {
  const channel = await resolveChannel(guild, ref);
  if (!channel) throw new Error(`channel not found: ${ref}`);
  return channel;
}

export async function needMember(guild, ref) {
  const member = await resolveMember(guild, ref);
  if (!member) throw new Error(`member not found: ${ref}`);
  return member;
}

export async function needRole(guild, ref) {
  const role = await resolveRole(guild, ref);
  if (!role) throw new Error(`role not found: ${ref}`);
  return role;
}

export async function setTalk(guild, channel, allow) {
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    SendMessages: allow,
    SendMessagesInThreads: allow,
    CreatePublicThreads: allow,
    AddReactions: allow,
  });
}

export async function mutedRole(guild) {
  let role = guild.roles.cache.find((r) => r.name === 'Muted');
  if (role) return role;

  role = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'wellix mute role' });
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory || !channel.manageable) continue;
    await channel.permissionOverwrites
      .edit(role, {
        SendMessages: false,
        SendMessagesInThreads: false,
        AddReactions: false,
        Speak: false,
      })
      .catch(() => {});
  }
  return role;
}

export function shortChannel(channel) {
  return `#${channel.name} (${channel.id})`;
}

export function shortMember(member) {
  return `${member.user.tag} (${member.id})`;
}

export function shortRole(role) {
  return `${role.name} (${role.id})`;
}
