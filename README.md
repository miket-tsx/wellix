# wellix

Discord bot with three parts:

1. **100 moderation commands**, each one available as `/command` and `prefix + command`.
2. **An agent** — mention the bot and describe what you want. It works through a capability catalog of 689 actions: channels, roles, permissions, tickets, automod, reports, bulk operations, scheduled jobs, and whatever it can compose out of those.
3. **A ticket system** with panel buttons, claim/close, transcripts.

It does not build new slash commands. Anything the agent does, it does directly through the API.

---

## setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| var | what |
| --- | --- |
| `DISCORD_TOKEN` | bot token |
| `CLIENT_ID` | application id |
| `GUILD_ID` | optional. registers commands instantly in one server instead of globally |
| `PREFIX` | text prefix, default `w!` |
| `OWNER_IDS` | comma separated ids that bypass permission checks |
| `AI_BASE_URL` | any OpenAI compatible endpoint |
| `AI_API_KEY` | key for that endpoint |
| `AI_MODEL` | model name |
| `AI_ALLOW_DESTRUCTIVE` | `false` blocks delete/ban/purge class capabilities |
| `SELFBUILD` | reserved for the code-wise feature builder |

Register commands once:

```bash
npm run deploy
```

Then:

```bash
npm start
```

Global slash commands can take up to an hour to appear. With `GUILD_ID` set they show up immediately. Discord caps global slash commands at 100 — that is exactly what this bot ships, so leave `GUILD_ID` empty only if you never add more.

### intents

Enable **Message Content** and **Server Members** in the developer portal. The bot asks for:

`Guilds, GuildMembers, GuildMessages, MessageContent, GuildModeration, GuildEmojisAndStickers, GuildInvites, GuildVoiceStates, GuildMessageReactions`

### permissions

Administrator is the honest answer, because the agent touches channels, roles, members, webhooks and invites. If you want to be strict, the minimum useful set is:

```
Manage Channels, Manage Roles, Manage Messages, Manage Webhooks,
Kick Members, Ban Members, Moderate Members, Manage Guild,
Manage Emojis and Stickers, View Audit Log, Create Invite,
Read Message History, Send Messages, Embed Links, Attach Files, Add Reactions
```

### avatar

If the bot is already in the Wellix server:

```bash
npm run avatar
```

It takes the guild icon and sets it as the bot avatar.

---

## commands

`w!help` lists everything grouped by category. `w!help <command>` shows the argument list.

| category | count | examples |
| --- | --- | --- |
| moderation | 20 | `ban`, `tempban`, `softban`, `timeout`, `warn`, `mute`, `notes`, `memberinfo` |
| roles | 15 | `addrole`, `massrole`, `autorole`, `rolebackup`, `rolerestore` |
| channels | 15 | `lock`, `lockdown`, `nuke`, `purge`, `purgeuser`, `slowmode`, `clonechannel` |
| messages | 15 | `say`, `embed`, `poll`, `announce`, `massdm`, `snipe`, `editsnipe` |
| server | 12 | `serverinfo`, `servericon`, `invites`, `emojiadd`, `boosters` |
| utility | 13 | `case`, `history`, `audit`, `permcheck`, `badwords`, `automod` |
| tickets + automation | 10 | `ticketpanel`, `ticketclaim`, `welcome`, `goodbye`, `autoresponder`, `settings` |

Every command works both ways:

```
w!ban @user spam 3
/ban user:@user reason:spam days:3
```

Prefix parsing is positional. Multi word arguments work at the end or when the argument after it is a channel/role/member mention:

```
w!say hello there #general
w!welcome #general welcome to the server
w!ban @user repeated spam links
```

---

## the agent

Mention it and talk normally:

```
@wellix make this server better
@wellix set the server up for a gaming community
@wellix add a rules channel, lock it, and put the rules in it
@wellix this place is dead, give it some structure
@wellix warn everyone who has the "raider" role and then remove that role
```

What happens under the hood:

1. The message is stripped of the mention and sent to the configured model with a server snapshot (categories, channels, roles, settings) and the capability index.
2. The model answers with JSON: a thought, a list of capability calls, and something to say.
3. Every call runs against discord.js. Results (including errors) go back to the model.
4. It retries failures with corrected arguments, then posts a short summary.

The loop is capped by `AI_MAX_STEPS` and 8 actions per step. `AI_ALLOW_DESTRUCTIVE=false` turns refusals into tool errors the model can see, so it will explain instead of doing it.

### capabilities

689 at boot, built from a resource × verb matrix plus generated fans:

- base actions on channels, categories, threads, webhooks, messages, invites, members, roles, emojis, stickers, server settings, tickets, welcome/goodbye, autoresponders, reaction roles, schedules, cases, utility reads, and guild settings
- 196 channel permission operations (`channel.allow.ManageMessages`, `channel.denyRole.SendMessages`, `channel.allowMember.AttachFiles`, …)
- 48 role permission operations (`role.grant.Administrator`, `role.revoke.ManageGuild`, …)
- the whole 100 command set, exposed as `cmd.ban`, `cmd.purge`, `cmd.ticketpanel`, …
- audit log filters, channel/role templates, server bootstrap presets, ticket panels, automod presets, welcome and embed templates, quick timeouts, purge filters, bulk operations, and JSON/CSV/text reports

The model only gets the short names up front. For the rest it calls:

```
cap.search   {"query":"permission overwrite"}
cap.describe {"name":"channel.denyRole.SendMessages"}
```

Both are built into the agent loop, not the catalog.

Need to know the real number? It prints at boot:

```
wellix online as wellix#1234
100 commands, 689 capabilities
```

---

## tickets

```
w!ticketpanel #support
w!settings support_role:@Staff
```

The panel has one button. Pressing it creates a private channel `ticket-0001`, denies `@everyone`, allows the opener, the support role and the bot. Inside are **claim** and **close** buttons.

Closing writes a transcript to `data/transcripts/ticket-0001-<timestamp>.txt`, posts it to the log channel if one is configured, then deletes the channel after five seconds.

```
w!settings modlog:#mod-log
w!ticketadd @helper
w!ticketclaim
```

---

## self-built features

The bot can add event driven behaviour without anyone writing commands. You ask, it stores a spec, the spec runs on messages/joins/leaves.

Spec shape:

```json
{
  "name": "greet new people",
  "on": "join",
  "actions": [
    { "type": "dm", "content": "hey {name}, welcome to {server}" },
    { "type": "send", "channel": "welcome", "content": "welcome {user}, member #{count}" }
  ]
}
```

Message triggers:

```json
{
  "name": "auto answer",
  "on": "message",
  "match": { "contains": "how do i apply", "channel": "general" },
  "actions": [{ "type": "reply", "content": "check #applications" }]
}
```

Actions: `send`, `reply`, `dm`, `addRole`, `removeRole`, `delete`, `log`, `embed`. Variables: `{user}`, `{name}`, `{tag}`, `{id}`, `{server}`, `{count}`, `{created}`, `{time}`.

The agent calls `feature.create` with that object. `feature.list`, `feature.enable`, `feature.disable`, `feature.test` and `feature.delete` exist too. Specs live in `data/wellix.json` under `features`.

This is declarative on purpose — no `eval`, no generated code in the hot path. `SELFBUILD=true` is reserved for a code-generation mode and is off by default.

---

## data

Everything is one JSON file, written debounced:

```
data/wellix.json
data/transcripts/
```

Wiped? `w!settings` shows what is configured. Cases, ticket counters, warnings, role backups, schedules and features survive restarts. Scheduled jobs (tempban expiry, reminders, delayed messages) are re-armed on boot.

---

## layout

```
src/
  index.js              client, events, prefix router, mention router
  deploy-commands.js    slash registration
  config.js             env parsing
  commands/             the 100 commands, split by category
  lib/
    registry.js         slash + prefix argument handling, permission gate
    moderation.js       cases, mod log
    db.js               json store and guild defaults
    scheduler.js        persisted timers
    resolvers.js        member/role/channel/user lookup
    cache.js            snipe and edit-snipe buffers
    render.js           embeds and template variables
    util.js             durations, chunking, ids
  features/
    tickets.js          panel, open, claim, close, transcript
    automod.js          spam, links, invites, badwords, caps
    welcome.js          join/leave messages, autoroles
    scripted.js         declarative feature engine
  ai/
    llm.js              openai compatible client + json salvage
    agent.js            the mention loop
    capabilities.js     catalog builder, fans, executor
    resources/          every capability implementation
scripts/
  set-avatar.js
```

---

## rough edges worth knowing

- Prefix arguments are positional. Quote multi word strings or put them last.
- `massdm` and `massrole` are real and slow on big servers. Discord rate limits apply.
- The agent can be confidently wrong about intent. It will not be wrong about results — errors come back from discord.js and get retried or reported.
- 100 global slash commands is the ceiling. If you want more later, register per guild.
- Automod is local to the bot (message deletion + timeout). It does not create Discord AutoMod rules, so it only works while the bot is online.
