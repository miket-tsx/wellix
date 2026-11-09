import { AuditLogEvent } from 'discord.js';
import { needChannel } from './_helpers.js';

const VERIFY = { none: 0, low: 1, medium: 2, high: 3, highest: 4 };
const FILTER = { disabled: 0, members: 1, all: 2 };

export default {
  server: {
    perm: 'ManageGuild',
    desc: 'server level settings',
    verbs: {
      rename: {
        d: 'Rename the server',
        p: { name: 'string!' },
        danger: 'high',
        run: async (guild, p) => {
          await guild.setName(p.name);
          return `server renamed to ${guild.name}`;
        },
      },
      setIcon: {
        d: 'Set the server icon from a url',
        p: { url: 'string!' },
        run: async (guild, p) => {
          await guild.setIcon(p.url);
          return 'icon updated';
        },
      },
      setBanner: {
        d: 'Set the server banner (tier 2 required)',
        p: { url: 'string!' },
        run: async (guild, p) => {
          await guild.setBanner(p.url);
          return 'banner updated';
        },
      },
      setAFK: {
        d: 'Set the AFK channel',
        p: { channel: 'channel!', timeout: 'int' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await guild.setAFKChannel(channel, p.timeout || 300);
          return `afk channel ${channel.name}, timeout ${guild.afkTimeout}s`;
        },
      },
      setSystemChannel: {
        d: 'Set the system message channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await guild.setSystemChannel(channel);
          return `system channel ${channel.name}`;
        },
      },
      setVerification: {
        d: 'Set the verification level',
        p: { level: 'enum:none|low|medium|high|highest' },
        run: async (guild, p) => {
          await guild.setVerificationLevel(VERIFY[p.level] ?? 1);
          return `verification ${p.level}`;
        },
      },
      setContentFilter: {
        d: 'Set explicit content filtering',
        p: { level: 'enum:disabled|members|all' },
        run: async (guild, p) => {
          await guild.setExplicitContentFilter(FILTER[p.level] ?? 0);
          return `content filter ${p.level}`;
        },
      },
      setLocale: {
        d: 'Set the preferred locale, e.g. en-US',
        p: { locale: 'string!' },
        run: async (guild, p) => {
          await guild.setPreferredLocale(p.locale);
          return `locale ${guild.preferredLocale}`;
        },
      },
      info: {
        d: 'Server overview',
        p: {},
        run: async (guild) => {
          const bots = guild.members.cache.filter((m) => m.user.bot).size;
          return `${guild.name} id=${guild.id} owner=${guild.ownerId} members=${guild.memberCount} bots=${bots} channels=${guild.channels.cache.size} roles=${guild.roles.cache.size} boosts=${guild.premiumSubscriptionCount || 0} tier=${guild.premiumTier} created=${guild.createdAt.toISOString()}`;
        },
      },
      boosters: {
        d: 'List boosters',
        p: {},
        run: async (guild) => {
          const boosters = guild.members.cache.filter((m) => m.premiumSinceTimestamp);
          return boosters.size
            ? boosters.map((m) => `${m.user.tag} since ${m.premiumSince?.toISOString()}`).join('\n')
            : 'no boosters';
        },
      },
      stats: {
        d: 'Quick counters',
        p: {},
        run: async (guild) => {
          const bots = guild.members.cache.filter((m) => m.user.bot).size;
          return `members=${guild.memberCount} bots=${bots} channels=${guild.channels.cache.size} roles=${guild.roles.cache.size} emojis=${guild.emojis.cache.size} stickers=${guild.stickers.cache.size}`;
        },
      },
      auditLog: {
        d: 'Read audit log entries',
        p: { limit: 'int' },
        run: async (guild, p) => {
          const logs = await guild.fetchAuditLogs({ limit: Math.min(p.limit || 10, 50) });
          return [...logs.entries.values()]
            .map((e) => {
              const action = Object.keys(AuditLogEvent).find((k) => AuditLogEvent[k] === e.action) || String(e.action);
              const target = e.target?.tag || e.target?.name || e.target?.id || '—';
              return `${action} by ${e.executor?.tag || '?'} -> ${target}`;
            })
            .join('\n');
        },
      },
    },
  },

  emoji: {
    perm: 'ManageEmojisAndStickers',
    desc: 'custom emojis',
    verbs: {
      create: {
        d: 'Upload an emoji',
        p: { name: 'string!', url: 'string!' },
        run: async (guild, p) => {
          const emoji = await guild.emojis.create({ attachment: p.url, name: p.name });
          return `added ${emoji} as :${emoji.name}:`;
        },
      },
      delete: {
        d: 'Delete an emoji',
        p: { emoji: 'string!' },
        run: async (guild, p) => {
          const raw = String(p.emoji);
          const id = raw.match(/\d{16,20}/)?.[0];
          const emoji = id
            ? guild.emojis.cache.get(id)
            : guild.emojis.cache.find((e) => e.name === raw.replace(/:/g, ''));
          if (!emoji) throw new Error('emoji not found');
          await emoji.delete();
          return `deleted :${emoji.name}:`;
        },
      },
      rename: {
        d: 'Rename an emoji',
        p: { emoji: 'string!', name: 'string!' },
        run: async (guild, p) => {
          const emoji = guild.emojis.cache.find((e) => e.name === p.emoji || e.id === p.emoji);
          if (!emoji) throw new Error('emoji not found');
          await emoji.setName(p.name);
          return `renamed to :${emoji.name}:`;
        },
      },
      list: {
        d: 'List emojis',
        p: {},
        run: async (guild) =>
          [...guild.emojis.cache.values()].map((e) => `${e} :${e.name}: (${e.id})`).join(' ') || 'none',
      },
    },
  },

  sticker: {
    perm: 'ManageEmojisAndStickers',
    desc: 'stickers',
    verbs: {
      list: {
        d: 'List stickers',
        p: {},
        run: async (guild) =>
          [...guild.stickers.cache.values()].map((s) => `${s.name} (${s.id})`).join('\n') || 'none',
      },
      delete: {
        d: 'Delete a sticker',
        p: { id: 'string!' },
        danger: 'high',
        run: async (guild, p) => {
          const sticker = guild.stickers.cache.get(p.id) || [...guild.stickers.cache.values()].find((s) => s.name === p.id);
          if (!sticker) throw new Error('sticker not found');
          await sticker.delete();
          return `deleted ${sticker.name}`;
        },
      },
    },
  },
};
