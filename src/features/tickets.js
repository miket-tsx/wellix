import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  FileBuilder,
  PermissionsBitField,
} from 'discord.js';
import { config } from '../config.js';
import { guildCfg, saveGuild } from '../lib/db.js';
import { COLOR, embed } from '../lib/render.js';
import { editReply, respond, send } from '../lib/cv2.js';
import { truncate } from '../lib/util.js';

const BTN = {
  open: 'ticket:open',
  close: 'ticket:close',
  claim: 'ticket:claim',
};

export async function sendPanel(channel, opts = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN.open).setLabel('open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
  );

  return send(channel, {
    embeds: [
      embed({
        title: opts.title || 'support tickets',
        description: opts.description || 'Press the button below and a private channel will be created for you.',
        color: COLOR.info,
      }),
    ],
    components: [row],
  });
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN.claim).setLabel('claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN.close).setLabel('close').setStyle(ButtonStyle.Danger),
  );
}

export async function openTicket(interaction) {
  const { guild, user } = interaction;
  const cfg = guildCfg(guild.id);

  const existing = Object.entries(cfg.tickets.open || {}).find(([, t]) => t.userId === user.id);
  if (existing) {
    return respond(interaction, { content: `You already have a ticket open: <#${existing[0]}>` }, { ephemeral: true });
  }

  await respond(interaction, { content: 'setting up your ticket…' }, { ephemeral: true });

  cfg.tickets.counter = (cfg.tickets.counter || 0) + 1;
  const number = String(cfg.tickets.counter).padStart(4, '0');
  const parent = cfg.tickets.category ? guild.channels.cache.get(cfg.tickets.category) : null;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];

  if (cfg.tickets.supportRole) {
    overwrites.push({
      id: cfg.tickets.supportRole,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${number}`,
    type: ChannelType.GuildText,
    parent: parent?.id,
    topic: `ticket #${number} · ${user.tag}`,
    permissionOverwrites: overwrites,
    reason: `ticket opened by ${user.tag}`,
  });

  cfg.tickets.open[channel.id] = {
    userId: user.id,
    number,
    openedAt: Date.now(),
    claimedBy: null,
  };
  saveGuild(guild.id, cfg);

  const ping = cfg.tickets.supportRole ? `<@&${cfg.tickets.supportRole}>` : '';
  await send(channel, {
    content: `<@${user.id}> ${ping}`.trim(),
    embeds: [
      embed({
        title: `ticket #${number}`,
        description: `${user} opened a ticket.\n\nStaff will be with you. Press **close** when it is done.`,
        color: COLOR.info,
      }),
    ],
    components: [panelRow()],
  });

  await editReply(interaction, { content: `Ticket opened: ${channel}` });
}

export async function closeTicket(channel, member, reason) {
  const guild = channel.guild;
  const cfg = guildCfg(guild.id);
  const ticket = cfg.tickets.open[channel.id];
  if (!ticket) throw new Error('not a ticket channel');

  const logChannel = cfg.tickets.log ? guild.channels.cache.get(cfg.tickets.log) : null;
  let file = null;

  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const lines = [...fetched.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content.replace(/\n/g, ' ')}`);
    const body = `ticket #${ticket.number}\nopened by ${ticket.userId}\nclosed by ${member.id}\nreason: ${reason || 'none'}\n\n${lines.join('\n')}`;

    fs.mkdirSync(path.join(config.dataDir, 'transcripts'), { recursive: true });
    const filename = `ticket-${ticket.number}-${Date.now()}.txt`;
    fs.writeFileSync(path.join(config.dataDir, 'transcripts', filename), body);
    file = new AttachmentBuilder(Buffer.from(body), { name: filename });
  } catch (err) {
    console.error('transcript failed:', err.message);
  }

  if (logChannel) {
    const log = embed({
      title: `ticket #${ticket.number} closed`,
      color: COLOR.err,
      fields: [
        { name: 'opened by', value: `<@${ticket.userId}>`, inline: true },
        { name: 'closed by', value: `${member}`, inline: true },
        { name: 'reason', value: truncate(reason || 'none', 500) },
      ],
    });

    if (file) log.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));

    await send(logChannel, { components: [log], files: file ? [file] : [] }).catch(() => {});
  }

  delete cfg.tickets.open[channel.id];
  saveGuild(guild.id, cfg);

  await send(channel, { embeds: [embed({ description: 'Ticket closed. Deleting in 5 seconds.', color: COLOR.err })] }).catch(() => {});
  setTimeout(() => channel.delete('ticket closed').catch(() => {}), 5000);
}

export async function addUserToTicket(channel, member) {
  await channel.permissionOverwrites.edit(member, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });
}

export async function removeUserFromTicket(channel, member) {
  await channel.permissionOverwrites.delete(member).catch(() => {});
}

export async function claimTicket(channel, member) {
  const cfg = guildCfg(channel.guild.id);
  const ticket = cfg.tickets.open[channel.id];
  if (!ticket) throw new Error('not a ticket');

  ticket.claimedBy = member.id;
  saveGuild(channel.guild.id, cfg);

  await channel.setTopic(`ticket #${ticket.number} · claimed by ${member.user.tag}`);
}

export async function handleTicketComponent(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('ticket:')) return false;

  if (id === BTN.open) {
    await openTicket(interaction);
    return true;
  }

  const cfg = guildCfg(interaction.guild.id);
  const ticket = cfg.tickets.open[interaction.channel.id];
  if (!ticket) {
    await respond(interaction, { content: 'This is not a ticket channel.' }, { ephemeral: true });
    return true;
  }

  if (id === BTN.claim) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await respond(interaction, { content: 'Staff only.' }, { ephemeral: true });
      return true;
    }
    await claimTicket(interaction.channel, interaction.member);
    await respond(interaction, { embeds: [embed({ description: `Claimed by ${interaction.member}.`, color: COLOR.ok })] });
    return true;
  }

  if (id === BTN.close) {
    const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages);
    if (!isStaff && interaction.user.id !== ticket.userId) {
      await respond(interaction, { content: 'Staff only.' }, { ephemeral: true });
      return true;
    }
    await respond(interaction, { embeds: [embed({ description: 'Closing…', color: COLOR.warn })] });
    await closeTicket(interaction.channel, interaction.member, 'button');
    return true;
  }

  return true;
}
