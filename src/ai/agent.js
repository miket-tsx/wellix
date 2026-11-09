import { ChannelType } from 'discord.js';
import { config } from '../config.js';
import { guildCfg } from '../lib/db.js';
import { truncate } from '../lib/util.js';
import { reply } from '../lib/cv2.js';
import { aiReady, chat, extractJson } from './llm.js';
import { capabilityNames, describeCapability, runCapability, searchCapabilities } from './capabilities.js';

const MAX_ACTIONS = 8;

function snapshot(guild) {
  const lines = [];

  for (const category of guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()) {
    const kids = category.children.cache
      .map((c) => `${c.type === ChannelType.GuildVoice ? 'voice:' : '#'}${c.name}`)
      .join(' ');
    lines.push(`${category.name} -> ${kids}`);
  }

  const loose = guild.channels.cache
    .filter((c) => !c.parentId && c.type !== ChannelType.GuildCategory)
    .map((c) => `#${c.name}`);
  if (loose.length) lines.push(`no category -> ${loose.join(' ')}`);

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .first(20)
    .map((r) => r.name);

  return `name=${guild.name} id=${guild.id} members=${guild.memberCount}\nchannels:\n${truncate(lines.join('\n'), 1600)}\nroles: ${roles.join(', ')}`;
}

function systemPrompt(guild, cfg) {
  const short = capabilityNames().filter((n) => n.split('.').length === 2);

  return [
    `You are Wellix, the autonomous administrator of the discord server "${guild.name}".`,
    'You are not a chat assistant. You change the server by calling capabilities.',
    '',
    'Reply with exactly one JSON object and nothing else:',
    '{"thought":"one short sentence","actions":[{"capability":"channel.create","params":{"name":"rules"}}],"say":"reply for the user"}',
    '',
    'Rules:',
    '- actions can be empty. then "say" is just your answer.',
    `- max ${MAX_ACTIONS} actions per reply.`,
    '- capability names are exact and case sensitive.',
    '- do not invent params. omit optional ones you do not need.',
    '- when an action fails, read the error and retry with corrected params.',
    '- "say" goes to the user. under 3 sentences, no headers, no code fences.',
    '- never claim something worked before the results say ok.',
    '- destructive actions are allowed. the owner asked for full autonomy.',
    `- prefix configured for normal commands: ${cfg.prefix || 'w!'} (users have their own commands, do not create new ones).`,
    '',
    `Capabilities: ${short.join(', ')}.`,
    '',
    'There are several hundred more: channel permissions (channel.allow|deny|reset.<Permission>), role permissions (role.grant|revoke.<Permission>), channel templates, role templates, server presets, audit filters, bulk operations, reports, ticket panels, automod presets, welcome and embed templates, quick timeouts, purge filters. Call cap.search {query} then cap.describe {name} to work out the params.',
    '',
    'Server snapshot:',
    snapshot(guild),
  ].join('\n');
}

export function agentReady() {
  return aiReady();
}

export async function handleAgentMessage(message, prompt) {
  const guild = message.guild;
  const cfg = guildCfg(guild.id);

  if (!cfg.ai.enabled) {
    return reply(message, 'the ai side is switched off on this server.').catch(() => {});
  }
  if (!aiReady()) {
    return reply(message, 'no ai key set. put AI_API_KEY in .env and restart.').catch(() => {});
  }

  const ctx = { client: message.client, actor: message.member, channel: message.channel };
  const history = [
    { role: 'system', content: systemPrompt(guild, cfg) },
    { role: 'user', content: `${message.author.username}: ${prompt}` },
  ];

  let say = '';
  const trace = [];

  await message.channel.sendTyping().catch(() => {});

  for (let step = 0; step < config.ai.steps; step++) {
    let raw;
    try {
      raw = await chat(history);
    } catch (err) {
      return reply(message, `ai error: ${truncate(err.message, 300)}`).catch(() => {});
    }

    const plan = extractJson(raw);
    if (!plan) {
      say = String(raw).slice(0, 1500);
      break;
    }
    if (plan.say) say = String(plan.say);

    const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, MAX_ACTIONS) : [];
    if (!actions.length) break;

    const results = [];

    for (const action of actions) {
      const name = String(action.capability || '');
      const params = action.params && typeof action.params === 'object' ? action.params : {};

      try {
        let result;
        if (name === 'cap.search') {
          result =
            searchCapabilities(params.query)
              .map((c) => `${c.name}: ${c.desc}`)
              .join('\n') || 'no match';
        } else if (name === 'cap.describe') {
          result = describeCapability(params.name) || 'no such capability';
        } else {
          result = await runCapability(name, guild, params, ctx);
        }
        results.push(`ok ${name}: ${truncate(result, 400)}`);
        trace.push(`${name} -> ${truncate(result, 160)}`);
      } catch (err) {
        results.push(`fail ${name}: ${truncate(err.message, 300)}`);
      }
    }

    history.push({ role: 'assistant', content: raw });
    history.push({
      role: 'user',
      content: `RESULTS\n${results.join('\n')}\n\nIf the task is complete reply with {"say":"...","actions":[]}. Otherwise keep going.`,
    });
  }

  const body =
    say.trim() ||
    (trace.length
      ? `done:\n${trace.slice(-8).map((t) => `- ${t}`).join('\n')}`
      : 'nothing needed changing.');

  return reply(
    message,
    { content: truncate(body, 1900), allowedMentions: { repliedUser: true } },
  ).catch(() => {});
}
