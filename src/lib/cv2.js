import {
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';

// components v2: no content, no embeds, everything is a component tree.
// https://discord.com/developers/docs/components/using-components
export const V2 = MessageFlags.IsComponentsV2;
export const ACCENT = 0x8b5cf6;

const ROOM = 3900;
const DISPLAY = 4000;

function cutter() {
  let left = ROOM;
  return (value, cap = DISPLAY) => {
    const raw = String(value ?? '');
    const room = Math.min(cap, left);
    if (room <= 0) return '';
    const out = raw.length > room ? `${raw.slice(0, room - 1)}…` : raw;
    left -= out.length;
    return out;
  };
}

const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

function fieldsText(fields) {
  return fields
    .filter((f) => f && f.name && f.value !== undefined && f.value !== null)
    .map((f) => `**${f.name}**\n${f.value}`)
    .join('\n\n');
}

// legacy embed shape in, container out. everything that still builds
// {title, description, fields} lands here.
export function fromEmbed(raw, accent = ACCENT) {
  const data = typeof raw?.toJSON === 'function' ? raw.toJSON() : raw || {};
  const take = cutter();
  const container = new ContainerBuilder();
  container.setAccentColor(typeof data.color === 'number' ? data.color : accent);

  const head = [];
  if (data.author?.name) head.push(take(`-# ${data.author.name}`, 200));
  if (data.title) head.push(take(`## ${data.title}`, 300));
  if (data.description) head.push(take(data.description, 3400));

  const body = head.filter(Boolean).join('\n');
  if (body) {
    if (data.thumbnail?.url) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnail.url)),
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }
  }

  const fields = fieldsText(data.fields || []);
  if (fields) {
    if (body) container.addSeparatorComponents(divider());
    const cut = take(fields, 2000);
    if (cut) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cut));
  }

  if (data.image?.url) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(data.image.url)));
  }

  const stamp = data.timestamp ? `<t:${Math.floor(new Date(data.timestamp).getTime() / 1000)}:f>` : '';
  const foot = [data.footer?.text, stamp].filter(Boolean).join(' · ');
  if (foot) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(take(`-# ${foot}`, 300)));

  if (!container.components.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('\u200b'));
  }

  return container;
}

function flagBits(flags) {
  if (Array.isArray(flags)) return flags.reduce((all, f) => all | Number(f), 0);
  return Number(flags) || 0;
}

// any payload shape in, a valid components v2 payload out.
export function toPayload(input, accent) {
  if (input instanceof ContainerBuilder) return { components: [input], flags: V2 };
  if (input instanceof ActionRowBuilder || input?.type === 1) {
    return { components: [new ContainerBuilder().addActionRowComponents(input)], flags: V2 };
  }
  if (typeof input?.toJSON === 'function') input = { embeds: [input] };

  const source = typeof input === 'string' ? { content: input } : { ...(input || {}) };
  const { content, embeds = [], components = [], flags, ...rest } = source;

  const blocks = [];
  const rows = [];

  if (content) blocks.push(new TextDisplayBuilder().setContent(String(content).slice(0, DISPLAY)));

  for (const item of embeds || []) {
    if (!item) continue;
    if (item instanceof ContainerBuilder) blocks.push(item);
    else blocks.push(fromEmbed(item, accent));
  }

  // an embed-shaped object passed at the top level (not wrapped in `embeds:`)
  if (blocks.length === 0 && rest && (rest.title || rest.description || rest.fields)) {
    blocks.push(fromEmbed(rest, accent));
    for (const k of ['title', 'description', 'color', 'fields', 'footer', 'thumbnail', 'image', 'author', 'timestamp']) {
      delete rest[k];
    }
  }

  for (const item of components || []) {
    if (!item) continue;
    if (item instanceof ContainerBuilder) blocks.push(item);
    else if (item instanceof ActionRowBuilder || item?.type === 1) rows.push(item);
    else blocks.push(item);
  }

  if (rows.length) {
    const host = blocks.find((block) => block instanceof ContainerBuilder);
    if (host) host.addActionRowComponents(...rows.slice(0, 5));
    else blocks.unshift(new ContainerBuilder().addActionRowComponents(...rows.slice(0, 5)));
  }

  const bits = flagBits(flags);
  if (!blocks.length) return Object.keys(rest).length ? { ...rest, flags: bits } : {};

  return {
    ...rest,
    components: blocks.slice(0, 10),
    flags: bits | V2,
  };
}

function componentText(component) {
  if (!component) return '';
  if (typeof component === 'string') return component;
  const data = typeof component.toJSON === 'function' ? component.toJSON() : component;

  const bits = [];
  if (data.content) bits.push(data.content);
  if (data.title) bits.push(data.title);
  if (data.description) bits.push(data.description);
  for (const field of data.fields || []) bits.push(`${field.name}: ${field.value}`);
  if (data.media?.url) bits.push(data.media.url);
  for (const child of data.components || []) bits.push(componentText(child));
  if (data.accessory?.media?.url) bits.push(data.accessory.media.url);
  if (data.accessory?.label) bits.push(data.accessory.label);
  for (const item of data.items || []) {
    if (item.description) bits.push(item.description);
    if (item.media?.url) bits.push(item.media.url);
  }

  return bits.filter(Boolean).join('\n');
}

// pull the readable part out of whatever was sent. agent traces and
// command mirrors feed this back into the model.
export function textOf(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;

  const bits = [];
  if (payload.content) bits.push(payload.content);
  for (const embed of payload.embeds || []) bits.push(componentText(embed));
  for (const component of payload.components || []) bits.push(componentText(component));

  return bits
    .filter(Boolean)
    .join('\n')
    .replace(/^#{1,3}\s*/gm, '')
    .trim();
}

export function send(channel, payload, opts = {}) {
  return channel.send(toPayload(payload, opts.accent));
}

export function reply(message, payload, opts = {}) {
  return message.reply(toPayload(payload, opts.accent));
}

export function dm(user, payload) {
  return user.send(toPayload(payload));
}

export function edit(message, payload, opts = {}) {
  return message.edit(toPayload(payload, opts.accent));
}

export function respond(interaction, payload, opts = {}) {
  const body = toPayload(payload, opts.accent);
  if (opts.ephemeral) body.flags = flagBits(body.flags) | MessageFlags.Ephemeral;

  if (interaction.deferred && !interaction.replied) return interaction.editReply(body);
  if (interaction.replied) return interaction.followUp(body);
  return interaction.reply(body);
}

// edits can't flip ephemeral, so drop that bit and keep the v2 marker.
export function editReply(interaction, payload, opts = {}) {
  const body = toPayload(payload, opts.accent);
  body.flags = flagBits(body.flags) & ~MessageFlags.Ephemeral;
  return interaction.editReply(body);
}
