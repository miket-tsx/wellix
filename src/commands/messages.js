import { COLOR, embed } from '../lib/render.js';
import { dm as sendDm, edit as editMessage, send } from '../lib/cv2.js';
import { cache } from '../lib/cache.js';
import { chunk, idFrom, sleep, truncate } from '../lib/util.js';
import { hexColor, listBody, missingBotPerms, page, stamp } from './shared.js';
import { B, C, S, U } from './helpers.js';

const NO_PING = { parse: [], repliedUser: false };
const TEXT_LIMIT = 2000;
const MASS_DM_BATCH = 4;
const MASS_DM_DELAY = 1200;
const MAX_POLL_OPTIONS = 10;
const POLL_MARKS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const CUSTOM_EMOJI = /^<a?([a-zA-Z0-9_~]{2,32}):(\d{16,20})>$/;
const EMOJI_ID = /^\d{16,20}$/;
const KEYCAP = /^[0-9#*]\ufe0f?\u20e3$/;

// name the exact channel-level permission the bot is missing.
function channelError(guild, ch, perms = ['ViewChannel', 'SendMessages']) {
  if (!ch) return 'that channel does not exist.';
  if (typeof ch.isTextBased === 'function' && !ch.isTextBased()) return 'that is not a text channel.';
  if (typeof ch.send !== 'function') return 'i cannot post in that channel.';

  const missing = missingBotPerms(guild, ch, perms);
  if (missing.length) {
    return `i am missing ${missing.map((p) => `\`${p}\``).join(', ')} in ${ch}.`;
  }
  return null;
}

// id -> replied-to -> most recent message (never the invoking prefix command).
async function resolveTarget(ctx, ch) {
  const raw = ctx.args?.id == null ? '' : String(ctx.args.id).trim();
  if (raw) {
    const id = idFrom(raw) || raw;
    if (!/^\d{16,20}$/.test(id)) return { error: 'that is not a valid message id or link.' };

    const msg = await ch.messages.fetch(id).catch(() => null);
    if (!msg) return { error: `no message with that id in ${ch} — it may have been deleted.` };
    return { msg };
  }

  const ref = ctx.message?.reference?.messageId;
  if (ref) {
    const msg = await ch.messages.fetch(ref).catch(() => null);
    if (!msg) return { error: 'the message you replied to was deleted.' };
    return { msg };
  }

  const latest = await ch.messages.fetch({ limit: 2 }).catch(() => null);
  const candidates = latest
    ? [...latest.values()]
        .filter((m) => m.id !== ctx.message?.id)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    : [];
  const msg = candidates[0] || (ctx.message ? null : latest?.first()) || null;
  if (!msg) return { error: `there is no message for me to act on in ${ch}.` };
  return { msg };
}

function messageCite(msg) {
  return msg?.url ? ` · [jump](${msg.url})` : '';
}

function authorTag(author) {
  if (!author) return 'unknown';
  return truncate(author.tag || author.username || String(author.id ?? author), 100);
}

function parseEmoji(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'give me an emoji to react with.' };
  if (raw.length > 80) return { error: 'that is not a valid emoji.' };

  const custom = raw.match(CUSTOM_EMOJI);
  if (custom) return { raw, value: raw, id: custom[2] };
  if (EMOJI_ID.test(raw)) return { raw, value: raw, id: raw };
  if (KEYCAP.test(raw)) return { raw, value: raw };
  if (/\s/.test(raw)) return { error: 'that is not a valid emoji.' };

  const stripped = raw.replace(
    /[\p{Extended_Pictographic}\u200d\ufe0f\u20e3\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu,
    '',
  );
  const looksEmoji = /\p{Extended_Pictographic}|\u20e3|[\u{1F1E6}-\u{1F1FF}]/u.test(raw);
  if (stripped.length || !looksEmoji) {
    return { error: 'use a unicode emoji or a custom `<:name:id>` emoji.' };
  }
  return { raw, value: raw };
}

function pollOptions(input) {
  const raw = input == null || !String(input).trim() ? 'Yes,No' : String(input);
  const seen = new Set();
  const options = [];
  let overflow = false;

  for (const piece of raw.split(',')) {
    const value = truncate(piece.trim(), 80);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    if (options.length >= MAX_POLL_OPTIONS) {
      overflow = true;
      continue;
    }

    seen.add(key);
    options.push(value);
  }

  if (options.length < 2) return { error: 'give me at least two options, like `yes, no, maybe`.' };
  return { options, overflow };
}

function attachmentLinks(urls) {
  return urls
    .slice(0, 3)
    .map((url, i) => `[file ${i + 1}](${url})`)
    .join(' · ')
    .concat(urls.length > 3 ? ` · +${urls.length - 3} more` : '');
}

export default [
  {
    name: 'say',
    desc: 'Make the bot say something',
    cat: 'messages',
    require: 'mod',
    options: [S('text', 'What to say', true), C('channel', 'Where (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const text = String(args.text ?? '').trim();
      if (!text) return err('give me something to say.');

      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'SendMessages']);
      if (bad) return err(bad);

      let sent;
      try {
        sent = await send(ch, { content: truncate(text, TEXT_LIMIT), allowedMentions: NO_PING });
      } catch (e) {
        return err(`could not post in ${ch}: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Sent to ${ch} · [jump](${sent.url}).`);
    },
  },
  {
    name: 'embed',
    desc: 'Post an embed',
    cat: 'messages',
    require: 'mod',
    options: [
      S('title', 'Title', true),
      S('description', 'Body text', true),
      S('color', 'Hex colour, e.g. #8b5cf6', false),
      C('channel', 'Where'),
    ],
    async run({ guild, channel, args, ok, err }) {
      const title = String(args.title ?? '').trim();
      const description = String(args.description ?? '').trim();
      if (!title) return err('give me a title.');
      if (!description) return err('give me some body text.');

      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'SendMessages', 'EmbedLinks']);
      if (bad) return err(bad);

      let color = COLOR.info;
      if (args.color != null && String(args.color).trim()) {
        color = hexColor(args.color);
        if (color === undefined) return err('that is not a valid hex colour — try `#8b5cf6`.');
      }

      let sent;
      try {
        sent = await send(ch, {
          embeds: [
            embed({
              title: truncate(title.replace(/\s+/g, ' '), 256),
              description: truncate(description, 3400),
              color,
            }),
          ],
          allowedMentions: NO_PING,
        });
      } catch (e) {
        return err(`could not post in ${ch}: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Embed posted in ${ch} · [jump](${sent.url}).`);
    },
  },
  {
    name: 'editlast',
    desc: 'Edit the last message the bot sent here',
    cat: 'messages',
    require: 'mod',
    options: [S('text', 'New content', true)],
    async run({ guild, channel, args, client, ok, err }) {
      const text = String(args.text ?? '').trim();
      if (!text) return err('give me the new text.');

      const bad = channelError(guild, channel, ['ViewChannel', 'ReadMessageHistory', 'SendMessages']);
      if (bad) return err(bad);

      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched) return err('i could not read this channel\'s history.');

      const mine = [...fetched.values()]
        .filter((m) => m.author?.id === client.user.id && m.editable)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];

      if (!mine) return err('i have no editable message in the last 100 here.');

      try {
        await editMessage(mine, { content: truncate(text, TEXT_LIMIT), allowedMentions: NO_PING });
      } catch (e) {
        if (e?.code === 10008) return err('that message was deleted before i could edit it.');
        return err(`could not edit it: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Edited [my last message](${mine.url}) in ${channel}.`);
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
      const { guild, channel, args, ok, err } = ctx;
      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory', 'ManageMessages']);
      if (bad) return err(bad);

      const { msg, error } = await resolveTarget(ctx, ch);
      if (error) return err(error);
      if (msg.deleted) return err('that message was already deleted.');

      const author = authorTag(msg.author);
      try {
        await msg.delete();
      } catch (e) {
        if (e?.code === 10008) return err('that message was already deleted.');
        return err(`could not delete it: ${truncate(e?.message ?? e, 200)}`);
      }

      const receipt = `Deleted **${author}**'s message in ${ch}.`;
      // replying to the invoking message would fail once it has been deleted.
      if (ctx.message?.id === msg.id) return ctx.send(receipt);
      return ok(receipt);
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
      const { guild, channel, args, ok, err } = ctx;
      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory', 'ManageMessages']);
      if (bad) return err(bad);

      const { msg, error } = await resolveTarget(ctx, ch);
      if (error) return err(error);
      if (msg.deleted) return err('that message was already deleted.');
      if (msg.pinned) return err('that message is already pinned.');

      const author = authorTag(msg.author);
      const cite = messageCite(msg);
      try {
        await msg.pin();
      } catch (e) {
        if (e?.code === 10008) return err('that message was deleted before i could pin it.');
        return err(`could not pin it: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Pinned **${author}**'s message in ${ch}${cite}.`);
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
      const { guild, channel, args, ok, err } = ctx;
      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory', 'ManageMessages']);
      if (bad) return err(bad);

      const { msg, error } = await resolveTarget(ctx, ch);
      if (error) return err(error);
      if (msg.deleted) return err('that message was already deleted.');
      if (!msg.pinned) return err('that message is not pinned.');

      const author = authorTag(msg.author);
      const cite = messageCite(msg);
      try {
        await msg.unpin();
      } catch (e) {
        if (e?.code === 10008) return err('that message was deleted before i could unpin it.');
        return err(`could not unpin it: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Unpinned **${author}**'s message in ${ch}${cite}.`);
    },
  },
  {
    name: 'pins',
    desc: 'List pinned messages',
    cat: 'messages',
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory']);
      if (bad) return err(bad);

      let pinned;
      try {
        pinned = await ch.messages.fetchPinned();
      } catch (e) {
        return err(`could not read pins: ${truncate(e?.message ?? e, 200)}`);
      }

      if (!pinned?.size) return ok(`no pins in ${ch}.`);

      const sorted = [...pinned.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const info = page(sorted, 1, 15);

      const lines = info.items.map((m) => {
        const body = m.content?.trim()
          ? truncate(m.content.replace(/\s+/g, ' '), 40).replace(/[[\]]/g, '')
          : m.attachments?.size
            ? `📎 ${m.attachments.size} attachment${m.attachments.size === 1 ? '' : 's'}`
            : '*no text*';
        const author = truncate(authorTag(m.author), 40);
        return `• [${body}](${m.url}) — **${author}** · ${stamp(m.createdTimestamp, 'd')}`;
      });

      const footer = [ch.name, `showing ${info.items.length} of ${sorted.length} newest`].join(' · ');

      return ok(
        embed({
          title: `pins · ${sorted.length}`,
          description: listBody(lines, 'no pins here.'),
          color: COLOR.neutral,
          footer,
        }),
      );
    },
  },
  {
    name: 'clearpins',
    desc: 'Remove every pin in a channel',
    cat: 'messages',
    require: 'mod',
    perms: ['ManageMessages'],
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory', 'ManageMessages']);
      if (bad) return err(bad);

      let pinned;
      try {
        pinned = await ch.messages.fetchPinned();
      } catch (e) {
        return err(`could not read pins: ${truncate(e?.message ?? e, 200)}`);
      }

      if (!pinned?.size) return ok(`no pins to remove in ${ch}.`);

      let removed = 0;
      let failed = 0;
      for (const msg of pinned.values()) {
        await msg.unpin().then(() => removed++).catch(() => failed++);
      }

      if (!removed) return err(`could not remove any of the ${failed} pins in ${ch}.`);
      const tail = failed ? ` · ${failed} failed` : '';
      return ok(`Removed ${removed}/${pinned.size} pins in ${ch}${tail}.`);
    },
  },
  {
    name: 'react',
    desc: 'Add a reaction to a message',
    cat: 'messages',
    require: 'mod',
    options: [
      S('emoji', 'Unicode emoji or <:name:id>', true),
      S('id', 'Message id'),
      C('channel', 'Channel (default: here)'),
    ],
    async run(ctx) {
      const { guild, channel, args, ok, err } = ctx;
      const emoji = parseEmoji(args.emoji);
      if (emoji.error) return err(emoji.error);

      const ch = args.channel || channel;
      const bad = channelError(guild, ch, ['ViewChannel', 'ReadMessageHistory', 'AddReactions']);
      if (bad) return err(bad);

      const { msg, error } = await resolveTarget(ctx, ch);
      if (error) return err(error);
      if (msg.deleted) return err('that message was already deleted.');

      const author = authorTag(msg.author);
      const cite = messageCite(msg);
      const already = msg.reactions.cache.some(
        (reaction) => reaction.me && (emoji.id ? reaction.emoji.id === emoji.id : reaction.emoji.name === emoji.raw),
      );
      if (already) return ok(`already reacted with ${emoji.raw} to **${author}**'s message${cite}.`);

      try {
        await msg.react(emoji.value);
      } catch (e) {
        if (e?.code === 10008) return err('that message was deleted before i could react.');
        return err(`could not react: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`Reacted with ${emoji.raw} to **${author}**'s message${cite}.`);
    },
  },
  {
    name: 'poll',
    desc: 'Quick reaction poll',
    cat: 'messages',
    options: [S('question', 'The question', true), S('options', 'Comma separated, 2-10 options')],
    async run({ guild, channel, args, ok, err }) {
      const question = String(args.question ?? '').trim();
      if (!question) return err('give me a question.');

      const parsed = pollOptions(args.options);
      if (parsed.error) return err(parsed.error);

      const bad = channelError(guild, channel, [
        'ViewChannel',
        'SendMessages',
        'EmbedLinks',
        'AddReactions',
      ]);
      if (bad) return err(bad);

      const body = parsed.options.map((option, i) => `${POLL_MARKS[i]} ${option}`).join('\n');
      const footer = [
        `${parsed.options.length} options`,
        'react to vote',
        parsed.overflow ? `first ${MAX_POLL_OPTIONS} shown` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      let sent;
      try {
        sent = await send(channel, {
          embeds: [
            embed({
              title: 'poll',
              description: `**${truncate(question, 300)}**\n\n${body}`,
              color: COLOR.info,
              footer,
            }),
          ],
          allowedMentions: NO_PING,
        });
      } catch (e) {
        return err(`could not post the poll: ${truncate(e?.message ?? e, 200)}`);
      }

      let failed = 0;
      for (let i = 0; i < parsed.options.length; i++) {
        await sent.react(POLL_MARKS[i]).catch(() => failed++);
      }

      const tail = failed ? ` · ${failed} reactions failed` : '';
      return ok(`Poll posted in ${channel} · [jump](${sent.url})${tail}.`);
    },
  },
  {
    name: 'announce',
    desc: 'Send an announcement, optionally pinging everyone',
    cat: 'messages',
    require: 'admin',
    options: [C('channel', 'Where', true), S('text', 'Message', true), B('ping', 'Ping @everyone')],
    async run({ guild, args, ok, err }) {
      const text = String(args.text ?? '').trim();
      if (!text) return err('give me the announcement text.');

      const ch = args.channel;
      const perms = ['ViewChannel', 'SendMessages'];
      if (args.ping) perms.push('MentionEveryone');

      const bad = channelError(guild, ch, perms);
      if (bad) return err(bad);

      let sent;
      try {
        sent = await send(ch, {
          content: truncate(text, TEXT_LIMIT),
          allowedMentions: args.ping ? { parse: ['everyone'] } : NO_PING,
        });
      } catch (e) {
        return err(`could not announce in ${ch}: ${truncate(e?.message ?? e, 200)}`);
      }

      const ping = args.ping ? ' with @everyone' : '';
      return ok(`Announcement posted in ${ch}${ping} · [jump](${sent.url}).`);
    },
  },
  {
    name: 'dm',
    desc: 'DM someone as the bot',
    cat: 'messages',
    require: 'admin',
    options: [U('user', 'Recipient', true), S('text', 'Message', true)],
    async run({ client, args, ok, err }) {
      const text = String(args.text ?? '').trim();
      if (!text) return err('give me a message to send.');
      if (!args.user) return err('that user could not be resolved.');
      if (args.user.id === client.user.id) return err('that is me.');

      try {
        await sendDm(args.user, truncate(text, TEXT_LIMIT));
      } catch (e) {
        if (e?.code === 50007) return err(`**${authorTag(args.user)}** has dms closed, so it could not be delivered.`);
        return err(`could not dm **${authorTag(args.user)}**: ${truncate(e?.message ?? e, 200)}`);
      }

      return ok(`DM sent to **${authorTag(args.user)}**.`);
    },
  },
  {
    name: 'massdm',
    desc: 'DM every human member',
    cat: 'messages',
    require: 'admin',
    options: [S('text', 'Message', true), B('confirm', 'Really?', true)],
    async run({ guild, client, args, ok, err }) {
      if (!args.confirm) return err('pass confirm:true to dm every human member.');

      const text = String(args.text ?? '').trim();
      if (!text) return err('give me a message to send.');
      const body = truncate(text, TEXT_LIMIT);

      const fetched = await guild.members.fetch().catch(() => null);
      const source = fetched || guild.members.cache;
      const seen = new Set();
      const targets = [...source.values()].filter((m) => {
        if (!m?.user || m.user.bot || m.id === client.user.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      if (!targets.length) return err('there are no human members to dm.');

      let sent = 0;
      let failed = 0;
      let closed = 0;
      const batches = chunk(targets, MASS_DM_BATCH);

      for (let i = 0; i < batches.length; i++) {
        const results = await Promise.all(
          batches[i].map(async (m) => {
            try {
              await sendDm(m.user, body);
              return 'sent';
            } catch (e) {
              return e?.code === 50007 ? 'closed' : 'failed';
            }
          }),
        );

        for (const result of results) {
          if (result === 'sent') sent++;
          else {
            failed++;
            if (result === 'closed') closed++;
          }
        }

        if (i < batches.length - 1) await sleep(MASS_DM_DELAY);
      }

      const tail = closed ? ` (${closed} closed dms)` : '';
      return ok(`Mass DM finished · sent ${sent} · failed ${failed}${tail} of ${targets.length} humans.`);
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
      if (!s) return err('nothing to snipe here yet.');

      const attachments = Array.isArray(s.attachments) ? s.attachments.filter(Boolean) : [];
      const body = s.content?.trim()
        ? truncate(s.content, 1800)
        : attachments.length
          ? '*attachment only — no text*'
          : '*no text content*';
      const description = [body, attachments.length ? `📎 ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join('\n\n');

      const fields = [
        {
          name: 'author',
          value: s.author?.id ? `**${authorTag(s.author)}** · <@${s.author.id}>` : `**${authorTag(s.author)}**`,
          inline: true,
        },
        { name: 'deleted', value: stamp(s.at, 'R'), inline: true },
      ];
      if (attachments.length) fields.push({ name: 'attachments', value: attachmentLinks(attachments) });

      const image = attachments.find((url) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));

      return ok(
        embed({
          title: 'deleted message',
          description,
          color: COLOR.err,
          fields,
          image,
          footer: `#${channel.name}`,
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
      if (!e) return err('nothing has been edited here recently.');

      const before = e.before?.trim() ? truncate(e.before, 900) : '*empty*';
      const after = e.after?.trim() ? truncate(e.after, 900) : '*empty*';

      return ok(
        embed({
          title: 'edited message',
          description: `**before**\n${before}\n\n**after**\n${after}`,
          color: COLOR.warn,
          fields: [
            {
              name: 'author',
              value: e.author?.id ? `**${authorTag(e.author)}** · <@${e.author.id}>` : `**${authorTag(e.author)}**`,
              inline: true,
            },
            { name: 'edited', value: stamp(e.at, 'R'), inline: true },
          ],
          footer: `#${channel.name}`,
        }),
      );
    },
  },
];
