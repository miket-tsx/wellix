import { ChannelType, PermissionsBitField } from 'discord.js';
import { send } from '../../lib/cv2.js';
import { clamp } from '../../lib/util.js';
import { needChannel, setTalk, shortChannel, shortRole } from './_helpers.js';

const KINDS = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
};

const TEXTY = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

export default {
  channel: {
    perm: 'ManageChannels',
    desc: 'guild channels',
    verbs: {
      create: {
        d: 'Create a channel',
        p: {
          name: 'string!',
          kind: 'enum:text|voice|category|announcement|stage|forum',
          parent: 'channel',
          topic: 'string',
          nsfw: 'bool',
        },
        run: async (guild, p) => {
          const type = KINDS[p.kind] ?? ChannelType.GuildText;
          const parent = p.parent ? await needChannel(guild, p.parent) : null;
          const channel = await guild.channels.create({
            name: p.name,
            type,
            parent: parent?.id,
            reason: 'wellix',
            ...(TEXTY.includes(type) ? { topic: p.topic || undefined, nsfw: !!p.nsfw } : {}),
            ...(type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice ? { userLimit: p.limit ? clamp(Number(p.limit), 0, 99) : 0 } : {}),
          });
          return `created ${shortChannel(channel)}`;
        },
      },

      delete: {
        d: 'Delete a channel',
        p: { channel: 'channel!' },
        danger: 'high',
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.delete('wellix');
          return `deleted ${channel.name}`;
        },
      },

      clone: {
        d: 'Clone a channel with its permissions',
        p: { channel: 'channel!', name: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const clone = await channel.clone({ name: p.name || undefined, reason: 'wellix' });
          return `cloned into ${shortChannel(clone)}`;
        },
      },

      rename: {
        d: 'Rename a channel',
        p: { channel: 'channel!', name: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setName(p.name);
          return `renamed to ${channel.name}`;
        },
      },

      setTopic: {
        d: 'Set a channel topic',
        p: { channel: 'channel!', topic: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setTopic(p.topic.slice(0, 1024));
          return `topic set on ${shortChannel(channel)}`;
        },
      },

      setNSFW: {
        d: 'Toggle the age restricted flag',
        p: { channel: 'channel!', nsfw: 'bool!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setNSFW(!!p.nsfw);
          return `nsfw=${!!p.nsfw} on ${channel.name}`;
        },
      },

      setSlowmode: {
        d: 'Set slowmode seconds',
        p: { channel: 'channel!', seconds: 'int!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setRateLimitPerUser(clamp(p.seconds, 0, 21600));
          return `slowmode ${channel.name}: ${clamp(p.seconds, 0, 21600)}s`;
        },
      },

      setPosition: {
        d: 'Move a channel',
        p: { channel: 'channel!', position: 'int!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setPosition(p.position);
          return `moved ${channel.name} to ${channel.position}`;
        },
      },

      setCategory: {
        d: 'Move a channel into a category (empty removes)',
        p: { channel: 'channel!', category: 'channel' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const parent = p.category ? await needChannel(guild, p.category) : null;
          if (parent && parent.type !== ChannelType.GuildCategory) throw new Error('category param is not a category');
          await channel.setParent(parent?.id ?? null);
          return `moved ${channel.name} to ${parent?.name || 'no category'}`;
        },
      },

      lock: {
        d: 'Deny @everyone send messages',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await setTalk(guild, channel, false);
          return `locked ${channel.name}`;
        },
      },

      unlock: {
        d: 'Allow @everyone send messages',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await setTalk(guild, channel, true);
          return `unlocked ${channel.name}`;
        },
      },

      hide: {
        d: 'Hide a channel from @everyone',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
          return `hid ${channel.name}`;
        },
      },

      show: {
        d: 'Reveal a channel to @everyone',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true });
          return `revealed ${channel.name}`;
        },
      },

      setUserLimit: {
        d: 'Voice channel user limit',
        p: { channel: 'channel!', limit: 'int!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setUserLimit(clamp(p.limit, 0, 99));
          return `${channel.name} limit ${channel.userLimit}`;
        },
      },

      setBitrate: {
        d: 'Voice channel bitrate in kbps',
        p: { channel: 'channel!', kbps: 'int!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setBitrate(clamp(p.kbps, 8, 384) * 1000);
          return `${channel.name} bitrate ${channel.bitrate / 1000}kbps`;
        },
      },

      archive: {
        d: 'Archive a thread',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          if (!channel.isThread()) throw new Error('not a thread');
          await channel.setArchived(true);
          return `archived ${channel.name}`;
        },
      },

      unarchive: {
        d: 'Unarchive a thread',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          if (!channel.isThread()) throw new Error('not a thread');
          await channel.setArchived(false);
          return `unarchived ${channel.name}`;
        },
      },

      list: {
        d: 'List channels grouped by category',
        p: {},
        run: async (guild) => {
          const lines = guild.channels.cache
            .filter((c) => c.type !== ChannelType.GuildCategory)
            .map((c) => `${c.parent?.name || '—'} / #${c.name} (${c.id})`);
          return lines.slice(0, 120).join('\n');
        },
      },

      info: {
        d: 'Details for one channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.channel);
          const perms = c.permissionOverwrites.cache.map((o) => {
            const target = guild.roles.cache.get(o.id) || guild.members.cache.get(o.id);
            return `${target?.name || o.id}: ${o.allow.toArray().join(',') || '—'}`;
          });
          return `#${c.name} id=${c.id} type=${c.type} topic=${c.topic || '—'} slowmode=${c.rateLimitPerUser}s\noverwrites:\n${perms.join('\n') || 'none'}`;
        },
      },
    },
  },

  category: {
    perm: 'ManageChannels',
    desc: 'channel categories',
    verbs: {
      create: {
        d: 'Create a category',
        p: { name: 'string!', position: 'int' },
        run: async (guild, p) => {
          const c = await guild.channels.create({ name: p.name, type: ChannelType.GuildCategory });
          if (p.position !== undefined) await c.setPosition(p.position).catch(() => {});
          return `created category ${c.name} (${c.id})`;
        },
      },
      delete: {
        d: 'Delete a category (channels inside are kept)',
        p: { category: 'channel!' },
        danger: 'high',
        run: async (guild, p) => {
          const c = await needChannel(guild, p.category);
          if (c.type !== ChannelType.GuildCategory) throw new Error('not a category');
          await c.delete();
          return `deleted category ${c.name}`;
        },
      },
      rename: {
        d: 'Rename a category',
        p: { category: 'channel!', name: 'string!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.category);
          await c.setName(p.name);
          return `renamed category to ${c.name}`;
        },
      },
      setPosition: {
        d: 'Move a category',
        p: { category: 'channel!', position: 'int!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.category);
          await c.setPosition(p.position);
          return `category ${c.name} at ${c.position}`;
        },
      },
      lock: {
        d: 'Lock all channels inside a category',
        p: { category: 'channel!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.category);
          let n = 0;
          for (const child of c.children.cache.values()) {
            await setTalk(guild, child, false).then(() => n++).catch(() => {});
          }
          return `locked ${n} channels in ${c.name}`;
        },
      },
      unlock: {
        d: 'Unlock all channels inside a category',
        p: { category: 'channel!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.category);
          let n = 0;
          for (const child of c.children.cache.values()) {
            await setTalk(guild, child, true).then(() => n++).catch(() => {});
          }
          return `unlocked ${n} channels in ${c.name}`;
        },
      },
    },
  },

  thread: {
    perm: 'CreatePublicThreads',
    desc: 'threads',
    verbs: {
      create: {
        d: 'Start a thread on a message channel',
        p: { channel: 'channel!', name: 'string!', message: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const thread = await channel.threads.create({
            name: p.name,
            autoArchiveDuration: 1440,
            reason: 'wellix',
            ...(p.message ? { message: { content: p.message } } : {}),
          });
          return `thread ${thread.name} (${thread.id})`;
        },
      },
      delete: {
        d: 'Delete a thread',
        p: { thread: 'channel!' },
        danger: 'high',
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          if (!t.isThread()) throw new Error('not a thread');
          await t.delete();
          return `deleted thread ${t.name}`;
        },
      },
      rename: {
        d: 'Rename a thread',
        p: { thread: 'channel!', name: 'string!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.setName(p.name);
          return `thread renamed ${t.name}`;
        },
      },
      archive: {
        d: 'Archive a thread',
        p: { thread: 'channel!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.setArchived(true);
          return `archived ${t.name}`;
        },
      },
      lock: {
        d: 'Lock a thread',
        p: { thread: 'channel!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.setLocked(true);
          return `locked ${t.name}`;
        },
      },
      unlock: {
        d: 'Unlock a thread',
        p: { thread: 'channel!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.setLocked(false);
          return `unlocked ${t.name}`;
        },
      },
      addMember: {
        d: 'Add a member to a thread',
        p: { thread: 'channel!', member: 'member!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.members.add(p.member);
          return `added to ${t.name}`;
        },
      },
      removeMember: {
        d: 'Remove a member from a thread',
        p: { thread: 'channel!', member: 'member!' },
        run: async (guild, p) => {
          const t = await needChannel(guild, p.thread);
          await t.members.remove(p.member);
          return `removed from ${t.name}`;
        },
      },
      list: {
        d: 'List active threads',
        p: {},
        run: async (guild) => {
          const threads = guild.channels.cache.filter((c) => c.isThread());
          return threads.map((t) => `${t.name} (${t.id}) parent=${t.parent?.name || '—'}`).slice(0, 80).join('\n') || 'no threads';
        },
      },
    },
  },

  webhook: {
    perm: 'ManageWebhooks',
    desc: 'webhooks',
    verbs: {
      create: {
        d: 'Create a webhook',
        p: { channel: 'channel!', name: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const hook = await channel.createWebhook({ name: p.name, reason: 'wellix' });
          return `webhook ${hook.name} ${hook.url}`;
        },
      },
      delete: {
        d: 'Delete a webhook by id',
        p: { id: 'string!' },
        danger: 'high',
        run: async (guild, p) => {
          const hooks = await guild.fetchWebhooks();
          const hook = hooks.get(p.id);
          if (!hook) throw new Error('webhook not found');
          await hook.delete();
          return `deleted webhook ${hook.name}`;
        },
      },
      list: {
        d: 'List webhooks',
        p: {},
        run: async (guild) => {
          const hooks = await guild.fetchWebhooks();
          return [...hooks.values()].map((h) => `${h.name} (${h.id}) #${h.channel?.name || '—'}`).join('\n') || 'none';
        },
      },
      send: {
        d: 'Send through a webhook',
        p: { id: 'string!', content: 'string!' },
        run: async (guild, p) => {
          const hooks = await guild.fetchWebhooks();
          const hook = hooks.get(p.id);
          if (!hook) throw new Error('webhook not found');
          await send(hook, { content: p.content.slice(0, 2000), allowedMentions: { parse: [] } });
          return 'sent';
        },
      },
    },
  },
};
