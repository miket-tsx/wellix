import { fromEmbed } from './cv2.js';

export const COLOR = {
  ok: 0x2ecc71,
  err: 0xe74c3c,
  info: 0x8b5cf6,
  warn: 0xf1c40f,
  mod: 0x3498db,
  neutral: 0x2b2d31,
};

// keeps the old call shape but hands back a container, not an embed.
export function embed(opts = {}) {
  return fromEmbed(
    {
      title: opts.title,
      description: opts.description,
      color: opts.color ?? COLOR.info,
      fields: opts.fields,
      footer: opts.footer ? { text: opts.footer } : undefined,
      thumbnail: opts.thumb ? { url: opts.thumb } : undefined,
      image: opts.image ? { url: opts.image } : undefined,
      author: opts.author ? (typeof opts.author === 'string' ? { name: opts.author } : opts.author) : undefined,
      timestamp: opts.timestamp === false ? undefined : new Date().toISOString(),
    },
    opts.color ?? COLOR.info,
  );
}

// {user} -> mention, {name} -> username, {tag} -> name#disc, {server}, {count}, {id}
export function applyVars(text, ctx = {}) {
  if (!text) return '';
  const user = ctx.user;
  return String(text)
    .replaceAll('{user}', user ? `<@${user.id}>` : '')
    .replaceAll('{name}', user?.username ?? '')
    .replaceAll('{tag}', user?.tag ?? user?.username ?? '')
    .replaceAll('{id}', user?.id ?? '')
    .replaceAll('{server}', ctx.guild?.name ?? '')
    .replaceAll('{count}', String(ctx.count ?? 0))
    .replaceAll('{created}', user ? `<t:${Math.floor(user.createdTimestamp / 1000)}:D>` : '')
    .replaceAll('{time}', `<t:${Math.floor(Date.now() / 1000)}:f>`);
}

export function errorText(err) {
  if (!err) return 'Unknown error';
  return String(err.message || err).slice(0, 900);
}
