import { COLOR, embed } from '../lib/render.js';
import { dm as sendDm, edit as editMessage, send } from '../lib/cv2.js';
import { cache } from '../lib/cache.js';
import { chunk, clamp, sleep, truncate } from '../lib/util.js';
import { B, C, I, M, S, U } from './helpers.js';

const NO_PING = { parse: [], repliedUser: false };

async function grab(ctx, channel) {
  const id = ctx.args.id || ctx.message?.reference?.messageId;
  if (id) return channel.messages.fetch(String(id)).catch(() => null);
  const last = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  return last?.first() || null;
}

export default [
  {
    name: 'say',
    desc: 'Make the bot say something',
    cat: 'messages',
    require: 'mod',
    options: [S('text', 'What to say', true), C('channel', 'Where (default: here)')],
    async run({ channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch?.isTextBased()) return err('Not a text channel.');
      await send(ch, { content: truncate(args.text, 2000), allowedMentions: NO_PING });
      return ok('Sent.');
    },
  },
  {
    name: 'embed',
    desc: 'Post an embed',
    cat: 'messages',
    require: 'mod',
    options: [S('title', 'Title', true), S('description', 'Body text', true), S('color', 'Hex colour', false), C('channel', 'Where')],
    async run({ channel, args, ok }) {
      const ch = args.channel || channel;
      const color = args.color ? parseInt(String(args.color).replace('#', ''), 16) : COLOR.info;
      await send(ch, {
        embeds: [embed({ title: args.title, description: truncate(args.description, 4000), color: Number.isFinite(color) ? color : COLOR.info })],
      });
      return ok('Embed posted.');
    },
  },
  {
    name: 'editlast',
    desc: 'Edit the last message the bot sent here',
    cat: 'messages',
    require: 'mod',
    options: [S('text', 'New content', true)],
    async run({ channel, args, client, ok, err }) {
      const msgs = await channel.messages.fetch({ limit: 30 });
      const mine = msgs.find((m) => m.author.id === client.user.id);
      if (!mine) return err('I have not said anything here recently.');
      await editMessage(mine, { content: truncate(args.text, 2000) });
      return ok('Edited.');
    },
  },
  {
    name: 'delete',
    desc: 'Delete a message by id (or the one you replied to)',
    cat: 'messages',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [S('id', 'Message id'), C('channel', 'Channel (default: here)')],
    async run(ctx) {
      const ch = ctx.args.channel || ctx.channel;
      const msg = await grab(ctx, ch);
      if (!msg) return ctx.err('Message not found.');
      await msg.delete().catch(() => {});
      return ctx.ok('Deleted.');
    },
  },
  {
    name: 'pin',
    desc: 'Pin a message',
    cat: 'messages',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [S('id', 'Message id'), C('channel', 'Channel (default: here)')],
    async run(ctx) {
      const ch = ctx.args.channel || ctx.channel;
      const msg = await grab(ctx, ch);
      if (!msg) return ctx.err('Message not found.');
      await msg.pin();
      return ctx.ok('Pinned.');
    },
  },
  {
    name: 'unpin',
    desc: 'Unpin a message',
    cat: 'messages',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [S('id', 'Message id'), C('channel', 'Channel (default: here)')],
    async run(ctx) {
      const ch = ctx.args.channel || ctx.channel;
      const msg = await grab(ctx, ch);
      if (!msg) return ctx.err('Message not found.');
      await msg.unpin().catch(() => {});
      return ctx.ok('Unpinned.');
    },
  },
  {
    name: 'pins',
    desc: 'List pinned messages',
    cat: 'messages',
    options: [C('channel', 'Channel (default: here)')],
    async run({ channel, args, ok }) {
      const ch = args.channel || channel;
      const pinned = await ch.messages.fetchPinned();
      if (!pinned.size) return ok('No pins here.');
      const lines = [...pinned.values()].slice(0, 20).map((m) => `[${truncate(m.content || 'embed', 40)}](${m.url}) — ${m.author.tag}`);
      return ok(embed({ title: `pins · ${pinned.size}`, description: lines.join('\n'), color: COLOR.neutral }));
    },
  },
  {
    name: 'clearpins',
    desc: 'Remove every pin in a channel',
    cat: 'messages',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [C('channel', 'Channel (default: here)')],
    async run({ channel, args, ok }) {
      const ch = args.channel || channel;
      const pinned = await ch.messages.fetchPinned();
      for (const m of pinned.values()) await m.unpin().catch(() => {});
      return ok(`Unpinned ${pinned.size} messages.`);
    },
  },
  {
    name: 'react',
    desc: 'Add a reaction to a message',
    cat: 'messages',
    require: 'mod',
    options: [S('emoji', 'Emoji', true), S('id', 'Message id'), C('channel', 'Channel (default: here)')],
    async run(ctx) {
      const ch = ctx.args.channel || ctx.channel;
      const msg = await grab(ctx, ch);
      if (!msg) return ctx.err('Message not found.');
      await msg.react(ctx.args.emoji).catch(() => {});
      return ctx.ok('Reacted.');
    },
  },
  {
    name: 'poll',
    desc: 'Quick reaction poll',
    cat: 'messages',
    options: [S('question', 'The question', true), S('options', 'Comma separated, up to 10')],
    async run({ channel, args, ok }) {
      const opts = String(args.options || 'Yes,No')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      const marks = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const body = opts.map((o, i) => `${marks[i]} ${o}`).join('\n');
      const msg = await send(channel, { embeds: [embed({ title: 'poll', description: `**${args.question}**\n\n${body}`, color: COLOR.info })] });
      for (let i = 0; i < opts.length; i++) await msg.react(marks[i]).catch(() => {});
      return ok('Poll up.');
    },
  },
  {
    name: 'announce',
    desc: 'Send an announcement, optionally pinging everyone',
    cat: 'messages',
    require: 'admin',
    options: [C('channel', 'Where', true), S('text', 'Message', true), B('ping', 'Ping @everyone')],
    async run({ args, ok, err }) {
      const ch = args.channel;
      if (!ch?.isTextBased()) return err('Not a text channel.');
      await send(ch, { content: truncate(args.text, 2000), allowedMentions: args.ping ? { parse: ['everyone'] } : NO_PING });
      return ok(`Announcement posted in ${ch}.`);
    },
  },
  {
    name: 'dm',
    desc: 'DM someone as the bot',
    cat: 'messages',
    require: 'admin',
    options: [U('user', 'Recipient', true), S('text', 'Message', true)],
    async run({ args, ok, err }) {
      const sent = await sendDm(args.user, truncate(args.text, 2000)).then(() => true).catch(() => false);
      if (!sent) return err('Their DMs are closed.');
      return ok(`DM sent to **${args.user.tag}**.`);
    },
  },
  {
    name: 'massdm',
    desc: 'DM every human member',
    cat: 'messages',
    require: 'admin',
    options: [S('text', 'Message', true), B('confirm', 'Really?', true)],
    async run({ guild, args, ok, err }) {
      if (!args.confirm) return err('Pass confirm:true to proceed.');
      const members = guild.members.cache.filter((m) => !m.user.bot);
      let sent = 0;
      let failed = 0;
      for (const batch of chunk([...members.values()], 4)) {
        await Promise.all(
          batch.map(async (m) => {
            const fine = await sendDm(m, truncate(args.text, 2000)).then(() => true).catch(() => false);
            fine ? sent++ : failed++;
            await sleep(400);
          }),
        );
      }
      return ok(`Sent ${sent}, failed ${failed} (closed DMs).`);
    },
  },
  {
    name: 'snipe',
    desc: 'Show the last deleted message here',
    cat: 'messages',
    require: 'mod',
    options: [],
    async run({ channel, ok, err }) {
      const s = cache.snipe(channel.id);
      if (!s) return err('Nothing to snipe.');
      return ok(
        embed({
          title: `deleted · ${s.author.tag}`,
          description: truncate(s.content || '*attachment only*', 2000),
          color: COLOR.err,
          footer: new Date(s.at).toLocaleString(),
          image: s.attachments[0],
        }),
      );
    },
  },
  {
    name: 'editsnipe',
    desc: 'Show the last edited message here',
    cat: 'messages',
    require: 'mod',
    options: [],
    async run({ channel, ok, err }) {
      const e = cache.edit(channel.id);
      if (!e) return err('Nothing to show.');
      return ok(
        embed({
          title: `edited · ${e.author.tag}`,
          description: `**before**\n${truncate(e.before, 900)}\n\n**after**\n${truncate(e.after, 900)}`,
          color: COLOR.warn,
        }),
      );
    },
  },
];
