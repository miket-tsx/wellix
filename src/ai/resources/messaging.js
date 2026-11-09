import { COLOR, embed } from '../../lib/render.js';
import { edit as editMessage, send } from '../../lib/cv2.js';
import { clamp } from '../../lib/util.js';
import { needChannel } from './_helpers.js';

const MARKS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export default {
  message: {
    perm: 'SendMessages',
    desc: 'messages in channels',
    verbs: {
      send: {
        d: 'Send a message',
        p: { channel: 'channel!', content: 'string!', embed: 'bool' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const payload = p.embed
            ? { embeds: [embed({ description: p.content.slice(0, 4000), color: COLOR.info })] }
            : { content: p.content.slice(0, 2000) };
          await send(channel, { ...payload, allowedMentions: { parse: [] } });
          return `sent to #${channel.name}`;
        },
      },

      edit: {
        d: 'Edit a message the bot sent',
        p: { channel: 'channel!', id: 'string!', content: 'string!' },
        run: async (guild, p, ctx) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          if (message.author.id !== ctx.client.user.id) throw new Error('that message is not mine');
          await editMessage(message, { content: p.content.slice(0, 2000) });
          return 'edited';
        },
      },

      delete: {
        d: 'Delete a message',
        p: { channel: 'channel!', id: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          await message.delete();
          return 'deleted';
        },
      },

      purge: {
        d: 'Bulk delete messages, optionally filtered',
        p: {
          channel: 'channel!',
          amount: 'int',
          mode: 'enum:all|user|bots|humans|embeds|files|links|invites|mentions|contains',
          user: 'member',
          contains: 'string',
        },
        danger: 'high',
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const limit = clamp(p.amount || 50, 1, 100);
          let list = [...(await channel.messages.fetch({ limit: 100 })).values()];

          switch (p.mode || 'all') {
            case 'bots':
              list = list.filter((m) => m.author.bot);
              break;
            case 'humans':
              list = list.filter((m) => !m.author.bot);
              break;
            case 'embeds':
              list = list.filter((m) => m.embeds.length);
              break;
            case 'files':
              list = list.filter((m) => m.attachments.size);
              break;
            case 'links':
              list = list.filter((m) => /https?:\/\//i.test(m.content));
              break;
            case 'invites':
              list = list.filter((m) => /discord\.(gg|com\/invite)\//i.test(m.content));
              break;
            case 'mentions':
              list = list.filter((m) => m.mentions.users.size || m.mentions.roles.size);
              break;
            case 'contains':
              list = list.filter((m) => m.content.toLowerCase().includes(String(p.contains || '').toLowerCase()));
              break;
            case 'user': {
              if (!p.user) throw new Error('mode=user needs the user param');
              list = list.filter((m) => m.author.id === p.user.id);
              break;
            }
            default:
              break;
          }

          list = list.slice(0, limit);
          if (!list.length) return 'nothing matched';
          const deleted = await channel.bulkDelete(list, true);
          return `deleted ${deleted.size} messages in #${channel.name}`;
        },
      },

      pin: {
        d: 'Pin a message',
        p: { channel: 'channel!', id: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          await message.pin();
          return 'pinned';
        },
      },

      unpin: {
        d: 'Unpin a message',
        p: { channel: 'channel!', id: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          await message.unpin();
          return 'unpinned';
        },
      },

      clearPins: {
        d: 'Remove every pin in a channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const pinned = await channel.messages.fetchPinned();
          for (const message of pinned.values()) await message.unpin().catch(() => {});
          return `unpinned ${pinned.size}`;
        },
      },

      react: {
        d: 'React to a message',
        p: { channel: 'channel!', id: 'string!', emoji: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          await message.react(p.emoji);
          return 'reacted';
        },
      },

      poll: {
        d: 'Post a reaction poll',
        p: { channel: 'channel!', question: 'string!', options: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const options = String(p.options || 'yes,no')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10);
          const body = options.map((o, i) => `${MARKS[i]} ${o}`).join('\n');
          const message = await send(channel, {
            embeds: [embed({ title: 'poll', description: `**${p.question}**\n\n${body}`, color: COLOR.info })],
          });
          for (let i = 0; i < options.length; i++) await message.react(MARKS[i]).catch(() => {});
          return `poll posted in #${channel.name}`;
        },
      },

      announce: {
        d: 'Post an announcement',
        p: { channel: 'channel!', content: 'string!', ping: 'bool' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await send(channel, {
            content: p.content.slice(0, 2000),
            allowedMentions: p.ping ? { parse: ['everyone'] } : { parse: [] },
          });
          return `announced in #${channel.name}`;
        },
      },

      embed: {
        d: 'Post an embed',
        p: { channel: 'channel!', title: 'string', description: 'string!', color: 'string', url: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const color = p.color ? parseInt(p.color.replace('#', ''), 16) : COLOR.info;
          await send(channel, {
            embeds: [
              embed({
                title: p.title || undefined,
                description: p.description.slice(0, 4000),
                color: Number.isFinite(color) ? color : COLOR.info,
                thumb: p.url || undefined,
              }),
            ],
          });
          return `embed posted in #${channel.name}`;
        },
      },

      fetch: {
        d: 'Read one message',
        p: { channel: 'channel!', id: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const message = await channel.messages.fetch(p.id).catch(() => null);
          if (!message) throw new Error('message not found');
          return `${message.author.tag}: ${message.content.slice(0, 1200)} (${message.createdAt.toISOString()})`;
        },
      },

      search: {
        d: 'Search recent messages in a channel',
        p: { channel: 'channel!', query: 'string!', limit: 'int' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const limit = clamp(p.limit || 20, 1, 50);
          const messages = await channel.messages.fetch({ limit: 100 });
          const hits = [...messages.values()].filter((m) =>
            m.content.toLowerCase().includes(String(p.query).toLowerCase()),
          );
          if (!hits.length) return 'no matches in the last 100 messages';
          return hits
            .slice(0, limit)
            .map((m) => `${m.author.tag} [${m.id}]: ${m.content.slice(0, 120)}`)
            .join('\n');
        },
      },
    },
  },

  invite: {
    perm: 'CreateInstantInvite',
    desc: 'invites',
    verbs: {
      create: {
        d: 'Create an invite',
        p: { channel: 'channel!', max_age: 'int', max_uses: 'int' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          if (!channel.createInvite) throw new Error('cannot invite to that channel');
          const invite = await channel.createInvite({
            maxAge: p.max_age ?? 86400,
            maxUses: p.max_uses ?? 0,
            reason: 'wellix',
          });
          return `https://discord.gg/${invite.code}`;
        },
      },
      delete: {
        d: 'Delete an invite by code',
        p: { code: 'string!' },
        run: async (guild, p) => {
          const invites = await guild.invites.fetch();
          const found = invites.find((i) => i.code === p.code);
          if (!found) throw new Error('invite not found');
          await found.delete();
          return `deleted ${p.code}`;
        },
      },
      list: {
        d: 'List invites and their use counts',
        p: {},
        run: async (guild) => {
          const invites = await guild.invites.fetch();
          if (!invites.size) return 'no active invites';
          return [...invites.values()]
            .sort((a, b) => (b.uses || 0) - (a.uses || 0))
            .map((i) => `${i.code} uses=${i.uses}/${i.maxUses || 'inf'} by=${i.inviter?.tag || '?'}`)
            .join('\n');
        },
      },
      info: {
        d: 'Inspect an invite',
        p: { code: 'string!' },
        run: async (guild, p, ctx) => {
          const invite = await ctx.client.fetchInvite(p.code).catch(() => null);
          if (!invite) throw new Error('invite is invalid or expired');
          return `${invite.guild?.name || 'dm'} / #${invite.channel?.name || '?'} uses=${invite.uses} by=${invite.inviter?.tag}`;
        },
      },
      revokeAll: {
        d: 'Delete every invite in the server',
        p: {},
        danger: 'high',
        run: async (guild) => {
          const invites = await guild.invites.fetch();
          let n = 0;
          for (const invite of invites.values()) {
            await invite.delete().then(() => n++).catch(() => {});
          }
          return `revoked ${n} invites`;
        },
      },
    },
  },
};
