import { COLOR, embed } from '../lib/render.js';
import { truncate } from '../lib/util.js';
import { missingBotPerms, listBody } from './shared.js';
import { A, B, C, I, S } from './helpers.js';

export default [
  {
    name: 'serverinfo',
    desc: 'Server overview',
    cat: 'server',
    options: [],
    async run({ guild, ok }) {
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const humans = guild.memberCount - bots;
      const textChannels = guild.channels.cache.filter((c) => c.isTextBased()).size;
      const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased()).size;
      return ok(
        embed({
          title: guild.name,
          thumb: guild.iconURL({ size: 256 }),
          color: COLOR.info,
          fields: [
            { name: 'id', value: `\`${guild.id}\``, inline: true },
            { name: 'owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            { name: 'members', value: `${humans} humans · ${bots} bots`, inline: true },
            { name: 'channels', value: `${textChannels} text · ${voiceChannels} voice`, inline: true },
            { name: 'roles', value: String(guild.roles.cache.size), inline: true },
            { name: 'emojis', value: String(guild.emojis.cache.size), inline: true },
            { name: 'boost tier', value: `tier ${guild.premiumTier} · ${guild.premiumSubscriptionCount || 0} boosts`, inline: true },
            { name: 'verification', value: String(guild.verificationLevel), inline: true },
            { name: 'features', value: truncate(guild.features.join(', ') || 'none', 500) },
          ],
        }),
      );
    },
  },
  {
    name: 'servericon',
    desc: 'Change the server icon',
    cat: 'server',
    require: 'admin',
    perms: ['ManageGuild'],
    options: [A('image', 'Upload an image'), S('url', 'Or paste an image url')],
    async run({ guild, args, ok, err }) {
      const missing = missingBotPerms(guild, null, ['ManageGuild']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);
      const src = args.image?.url || args.url;
      if (!src) return err('Attach an image or give a url.');
      await guild.setIcon(src).then(() => ok('Icon updated.')).catch((e) => err(e.message));
    },
  },
  {
    name: 'servername',
    desc: 'Rename the server',
    cat: 'server',
    require: 'admin',
    perms: ['ManageGuild'],
    options: [S('name', 'New name', true)],
    async run({ guild, args, ok, err }) {
      if (!args.name || args.name.length < 2 || args.name.length > 100) return err('Server name must be between 2 and 100 characters.');
      const missing = missingBotPerms(guild, null, ['ManageGuild']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);
      const old = guild.name;
      await guild.setName(args.name).then(() => ok(`**${old}** is now **${guild.name}**.`)).catch((e) => err(e.message));
    },
  },
  {
    name: 'serverbanner',
    desc: 'Change the server banner (needs boost tier 2)',
    cat: 'server',
    require: 'admin',
    perms: ['ManageGuild'],
    options: [A('image', 'Upload an image'), S('url', 'Or paste a url')],
    async run({ guild, args, ok, err }) {
      const missing = missingBotPerms(guild, null, ['ManageGuild']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);
      const src = args.image?.url || args.url;
      if (!src) return err('Attach an image or give a url.');
      await guild.setBanner(src).then(() => ok('Banner updated.')).catch((e) => err(e.message));
    },
  },
  {
    name: 'invites',
    desc: 'List active invites',
    cat: 'server',
    require: 'mod',
    perms: ['ManageGuild'],
    options: [],
    async run({ guild, ok }) {
      const invites = await guild.invites.fetch().catch(() => null);
      if (!invites?.size) return ok('No active invites.');
      const lines = [...invites.values()]
        .sort((a, b) => (b.uses || 0) - (a.uses || 0))
        .slice(0, 20)
        .map((i) => `\`${i.code}\` · ${i.uses}/${i.maxUses || '∞'} · ${i.inviter?.tag || 'unknown'}`);
      return ok(embed({ title: `invites · ${invites.size}`, description: listBody(lines), color: COLOR.neutral }));
    },
  },
  {
    name: 'invitecreate',
    desc: 'Create an invite',
    cat: 'server',
    require: 'admin',
    perms: ['CreateInstantInvite'],
    options: [C('channel', 'Channel'), I('max_age', 'Seconds until it expires', false, { min: 0, max: 604800 }), I('max_uses', '0 = unlimited', false, { min: 0, max: 100 })],
    async run({ channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch?.createInvite) return err('Pick a text channel.');
      const maxAge = args.max_age ?? 86400;
      const maxUses = args.max_uses ?? 0;
      const inv = await ch.createInvite({ maxAge, maxUses, reason: 'wellix invite' }).catch(() => null);
      if (!inv) return err('Failed to create the invite.');
      return ok(`Invite: https://discord.gg/${inv.code} (expires ${inv.maxAge ? `${maxAge}s` : 'never'}, uses ${inv.maxUses || '∞'})`);
    },
  },
  {
    name: 'inviteinfo',
    desc: 'Look up an invite code',
    cat: 'server',
    require: 'mod',
    options: [S('code', 'Code or full link', true)],
    async run({ client, args, ok, err }) {
      const code = String(args.code).match(/([a-zA-Z0-9-]{2,32})$/)?.[1];
      if (!code) return err('That does not look like an invite.');
      const inv = await client.fetchInvite(code).catch(() => null);
      if (!inv) return err('Invite is dead or invalid.');
      return ok(
        embed({
          title: `invite ${inv.code}`,
          color: COLOR.info,
          fields: [
            { name: 'server', value: inv.guild?.name || 'group dm', inline: true },
            { name: 'channel', value: inv.channel?.name || 'dm', inline: true },
            { name: 'inviter', value: inv.inviter?.tag || 'unknown', inline: true },
            { name: 'uses', value: String(inv.uses ?? 0), inline: true },
            { name: 'expires', value: inv.expiresAt ? `<t:${Math.floor(inv.expiresAt.getTime() / 1000)}:R>` : 'never', inline: true },
          ],
        }),
      );
    },
  },
  {
    name: 'emojis',
    desc: 'List custom emojis',
    cat: 'server',
    options: [],
    async run({ guild, ok }) {
      if (!guild.emojis.cache.size) return ok('No custom emojis.');
      const list = [...guild.emojis.cache.values()].slice(0, 40).map((e) => `${e} \`:${e.name}:\``);
      return ok(embed({ title: `emojis · ${guild.emojis.cache.size}`, description: list.join(' '), color: COLOR.neutral }));
    },
  },
  {
    name: 'emojiadd',
    desc: 'Upload a custom emoji',
    cat: 'server',
    require: 'admin',
    perms: ['ManageEmojisAndStickers'],
    options: [S('name', 'Emoji name', true), S('url', 'Image url'), A('image', 'Or upload one')],
    async run({ guild, args, ok, err }) {
      if (!args.name || !/^[a-zA-Z0-9_]{2,32}$/.test(args.name)) return err('Emoji name must be 2–32 alphanumeric characters or underscores.');
      const src = args.image?.url || args.url;
      if (!src) return err('Need an image url or upload.');
      const emoji = await guild.emojis.create({ attachment: src, name: args.name }).catch(() => null);
      if (!emoji) return err('Upload failed — check file size (256 KB), format, and name.');
      return ok(`Added ${emoji} as \`:${emoji.name}:\`.`);
    },
  },
  {
    name: 'emojiremove',
    desc: 'Delete a custom emoji',
    cat: 'server',
    require: 'admin',
    perms: ['ManageEmojisAndStickers'],
    options: [S('emoji', 'Name or id', true)],
    async run({ guild, args, ok, err }) {
      const raw = String(args.emoji).trim();
      const id = raw.match(/\d{16,20}/)?.[0];
      const emoji = id ? guild.emojis.cache.get(id) : guild.emojis.cache.find((e) => e.name === raw.replace(/:/g, ''));
      if (!emoji) return err('Emoji not found here.');
      if (emoji.managed) return err('That emoji is managed by an integration.');
      const name = emoji.name;
      await emoji.delete().catch(() => {});
      return ok(`Deleted \`:${name}:\`.`);
    },
  },
  {
    name: 'stickers',
    desc: 'List stickers',
    cat: 'server',
    options: [],
    async run({ guild, ok }) {
      if (!guild.stickers.cache.size) return ok('No stickers.');
      const list = [...guild.stickers.cache.values()].slice(0, 30).map((s) => `**${s.name}** \`${s.id}\``);
      return ok(embed({ title: `stickers · ${guild.stickers.cache.size}`, description: list.join('\n'), color: COLOR.neutral }));
    },
  },
  {
    name: 'boosters',
    desc: 'List server boosters',
    cat: 'server',
    options: [],
    async run({ guild, ok }) {
      const boosters = guild.members.cache.filter((m) => m.premiumSinceTimestamp).sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
      if (!boosters.size) return ok('No boosts yet.');
      const lines = boosters.first(20).map((m) => `**${m.user.tag}** — <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`);
      return ok(embed({ title: `boosters · ${boosters.size}`, description: lines.join('\n'), color: 0xff73fa }));
    },
  },
];
