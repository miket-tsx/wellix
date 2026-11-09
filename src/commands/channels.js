import { ChannelType, PermissionsBitField } from 'discord.js';
import { resolveChannel, resolveMember } from '../lib/resolvers.js';
import { COLOR, embed } from '../lib/render.js';
import { send } from '../lib/cv2.js';
import { clamp, truncate } from '../lib/util.js';
import { B, C, I, M, S } from './helpers.js';

const everyone = (guild) => guild.roles.everyone;

async function setSend(guild, channel, allow) {
  await channel.permissionOverwrites.edit(everyone(guild), {
    SendMessages: allow,
    SendMessagesInThreads: allow,
    CreatePublicThreads: allow,
    AddReactions: allow,
  });
}

export default [
  {
    name: 'slowmode',
    desc: 'Set channel slowmode',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [I('seconds', '0 to turn off', true, { min: 0, max: 21600 }), C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) return err('Not a text channel.');
      await ch.setRateLimitPerUser(clamp(args.seconds, 0, 21600));
      return ok(args.seconds ? `Slowmode set to ${args.seconds}s in ${ch}.` : `Slowmode off in ${ch}.`);
    },
  },
  {
    name: 'lock',
    desc: 'Stop @everyone from talking here',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel (default: here)'), S('reason', 'Why')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch.manageable) return err('I cannot edit that channel.');
      await setSend(guild, ch, false);
      return ok(`Locked ${ch}${args.reason ? ` — ${args.reason}` : ''}.`);
    },
  },
  {
    name: 'unlock',
    desc: 'Let @everyone talk here again',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch.manageable) return err('I cannot edit that channel.');
      await setSend(guild, ch, true);
      return ok(`Unlocked ${ch}.`);
    },
  },
  {
    name: 'lockdown',
    desc: 'Lock every text channel',
    cat: 'channels',
    require: 'admin',
    perms: ['ManageChannels'],
    options: [B('confirm', 'Really lock everything?', true)],
    async run({ guild, args, ok, err }) {
      if (!args.confirm) return err('Pass confirm:true to actually do it.');
      const channels = guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText && c.manageable && c.id !== guild.systemChannelId,
      );
      let n = 0;
      for (const ch of channels.values()) {
        await setSend(guild, ch, false).then(() => n++).catch(() => {});
      }
      return ok(`Locked ${n} channels. Staff can still type.`);
    },
  },
  {
    name: 'unlockall',
    desc: 'Unlock every text channel',
    cat: 'channels',
    require: 'admin',
    perms: ['ManageChannels'],
    options: [],
    async run({ guild, ok }) {
      const channels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && c.manageable);
      let n = 0;
      for (const ch of channels.values()) {
        await setSend(guild, ch, true).then(() => n++).catch(() => {});
      }
      return ok(`Unlocked ${n} channels.`);
    },
  },
  {
    name: 'nuke',
    desc: 'Clone and replace a channel, wiping its history',
    cat: 'channels',
    require: 'admin',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel to nuke (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const old = args.channel || channel;
      if (!old?.manageable) return err('I cannot manage that channel.');
      const clone = await old.clone({ reason: 'nuke' });
      await old.delete('nuke');
      send(clone, { embeds: [embed({ title: 'channel nuked', description: 'Fresh start.', color: COLOR.info })] }).catch(() => {});
      return ok(`Nuked into ${clone}.`);
    },
  },
  {
    name: 'purge',
    desc: 'Bulk delete recent messages',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [I('amount', '1-100', true, { min: 1, max: 100 })],
    async run({ channel, args, ok, err }) {
      if (!channel.bulkDelete) return err('Not a text channel.');
      const deleted = await channel.bulkDelete(clamp(args.amount, 1, 100), true);
      return ok(`Deleted ${deleted.size} messages.`);
    },
  },
  {
    name: 'purgeuser',
    desc: 'Delete messages from one user',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [M('member', 'Whose messages', true), I('amount', 'How many to scan (max 100)', false, { min: 1, max: 100 })],
    async run({ channel, args, ok, err }) {
      if (!args.member) return err('Member not found.');
      const limit = clamp(args.amount || 50, 1, 100);
      const fetched = await channel.messages.fetch({ limit: 100 });
      const mine = [...fetched.values()].filter((m) => m.author.id === args.member.id).slice(0, limit);
      if (!mine.length) return err('Nothing to delete.');
      const deleted = await channel.bulkDelete(mine, true);
      return ok(`Deleted ${deleted.size} messages from **${args.member.user.tag}**.`);
    },
  },
  {
    name: 'purgebots',
    desc: 'Delete bot messages',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [I('amount', 'How many to scan', false, { min: 1, max: 100 })],
    async run({ channel, args, ok }) {
      const fetched = await channel.messages.fetch({ limit: clamp(args.amount || 100, 1, 100) });
      const bots = [...fetched.values()].filter((m) => m.author.bot);
      if (!bots.length) return ok('No bot messages in range.');
      const deleted = await channel.bulkDelete(bots, true);
      return ok(`Deleted ${deleted.size} bot messages.`);
    },
  },
  {
    name: 'purgeembeds',
    desc: 'Delete messages that contain embeds',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [I('amount', 'How many to scan', false, { min: 1, max: 100 })],
    async run({ channel, args, ok }) {
      const fetched = await channel.messages.fetch({ limit: clamp(args.amount || 100, 1, 100) });
      const withEmbeds = [...fetched.values()].filter((m) => m.embeds.length);
      if (!withEmbeds.length) return ok('No embeds in range.');
      const deleted = await channel.bulkDelete(withEmbeds, true);
      return ok(`Deleted ${deleted.size} messages with embeds.`);
    },
  },
  {
    name: 'clonechannel',
    desc: 'Duplicate a channel',
    cat: 'channels',
    require: 'admin',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel to clone', true), S('name', 'New name (optional)')],
    async run({ args, ok, err }) {
      if (!args.channel) return err('Channel not found.');
      const clone = await args.channel.clone({ name: args.name || undefined, reason: 'clone' });
      return ok(`Cloned into ${clone}.`);
    },
  },
  {
    name: 'topic',
    desc: 'Set a channel topic',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [S('text', 'New topic (empty clears)', true), C('channel', 'Channel (default: here)')],
    async run({ channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (typeof ch.setTopic !== 'function') return err('That channel has no topic.');
      await ch.setTopic(truncate(args.text, 1024) || null);
      return ok('Topic updated.');
    },
  },
  {
    name: 'channelrename',
    desc: 'Rename a channel',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [S('name', 'New name', true), C('channel', 'Channel (default: here)')],
    async run({ channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch.manageable) return err('I cannot rename that channel.');
      const old = ch.name;
      await ch.setName(args.name);
      return ok(`**${old}** renamed to **${ch.name}**.`);
    },
  },
  {
    name: 'hidechannel',
    desc: 'Hide a channel from @everyone',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok }) {
      const ch = args.channel || channel;
      await ch.permissionOverwrites.edit(everyone(guild), { ViewChannel: false });
      return ok(`${ch} is now hidden.`);
    },
  },
  {
    name: 'showchannel',
    desc: 'Make a hidden channel visible',
    cat: 'channels',
    require: 'mod',
    perms: ['ManageChannels'],
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok }) {
      const ch = args.channel || channel;
      await ch.permissionOverwrites.edit(everyone(guild), { ViewChannel: true });
      return ok(`${ch} is visible again.`);
    },
  },
];
