# Wellix command standard

You are rewriting **one command module** (`src/commands/<file>.js`) of a production
Discord bot. The bar is "best-in-class moderation bot" — not a demo. Every command
must feel deliberate, safe, and polished. Take your time; correctness beats speed.

## Hard constraints (do not break these)

1. **Only edit your assigned file.** Never edit `src/commands/shared.js`,
   `helpers.js`, `registry.js`, `render.js`, `cv2.js`, `db.js`, `moderation.js`,
   `resolvers.js`, `util.js`, `scheduler.js`, or any other module.
2. Keep `export default [ ... ]` and the exact array-of-command-objects shape.
3. Keep the **command `name` strings exactly as they are** (slash registration and
   the help menu depend on them). Keep `cat` exactly as-is.
4. Keep existing **option names** and their required/optional status. You may
   improve option descriptions. You may add a new **optional** option only when it
   clearly improves the command and does not disturb prefix positional parsing.
5. No new npm dependencies. Node ESM only. `node --check` must pass.
6. Every command object: `{ name, desc, cat, require?, perms?, options?, run(ctx) }`.
7. Do not introduce interactive button flows that need new global handlers. Keep
   destructive confirmation via the existing boolean `confirm` option pattern.
8. Never write `content`/`embeds` at payload root. All user-visible output goes
   through `ctx.ok(...)` / `ctx.err(...)` (which normalize to Components V2) or
   `send(channel, payload)` from `../lib/cv2.js`.

## The `ctx` object

```js
ctx = {
  client, guild, channel, member, user, interaction, message, args,
  source: 'slash' | 'prefix',
  cfg,                 // guild config snapshot (db.js DEFAULTS shape)
  ok(payload),         // reply success (string | embed() container | payload)
  err(payload),        // reply error
  send(payload),       // send to the invoking channel
}
```

`args` values are already resolved:
- `member` -> GuildMember | undefined
- `user` -> User | undefined
- `role` -> Role | undefined
- `channel` -> GuildChannel | undefined
- `int`/`num` -> number
- `bool` -> boolean
- `attach` -> Attachment | undefined
- `string` -> string

## Shared helpers (`./shared.js`)

Import what you need; do not reimplement it.

```js
DAY, MAX_TIMEOUT, tagOf(u), stamp(ms, style='F'), yes(v),
getMember(guild, user), getBan(guild, id),
botMember(guild), highest(member),
canActOn(guild, target),        // owner/self/equal-or-higher -> false
canManageRole(guild, role),
botPerms(guild, channel),
missingBotPerms(guild, channel, ['ManageChannels']),
missingMemberPerms(member, [...]),
reasonFor(user, text, fallback), // "mod: reason"
hexColor('#8b5cf6'),
listBody(lines, empty), page(list, n, size), caseLine(c), caseFooter(info),
boundedDuration(input, { min, max, fallback }) -> { ms } | { error }
```

Also available: `truncate`, `fmtDuration`, `parseDuration`, `chunk`, `clamp`,
`escapeRegex`, `idFrom`, `unix`, `sleep`, `pick` from `../lib/util.js`.

## Every command must

1. **Validate first.** Null/undefined targets, empty strings, bad ranges, missing
   config — return a precise `err()` before touching the API.
2. **Guard hierarchy and identity.** For anything that acts on a member:
   - reject the guild owner and the bot itself,
   - reject when `!canActOn(guild, target)` (role too high),
   - for role assignment also reject `!canManageRole(guild, role)`.
3. **Preflight bot permissions** with `missingBotPerms(guild, channel, [...])` and
   name the exact missing permissions in the error.
4. **Log a moderation case** for punish/state actions via `addCase()` from
   `../lib/moderation.js` (kick, ban, softban, tempban, unban, unbanall, warn,
   mute, unmute, timeout, untimeout, note, etc.). Include `targetId`, `targetTag`,
   `moderatorId`, `reason`, and `duration` where relevant.
5. **DM the target** (best effort, `.catch(() => {})`) for punish actions that
   notify a human (kick/ban/tempban/warn/timeout/mute), using `dm()` from
   `../lib/cv2.js`. Never let a closed DM fail the command.
6. **Confirm destructive bulk actions** via the existing `confirm` boolean option:
   return `err('pass confirm:true ...')` when it is not set. Clear, specific text.
7. **Report real counts** for bulk operations (`done/skipped/failed`), and skip
   members the bot cannot act on instead of aborting the whole run.
8. **Be idempotent-friendly.** "Already has role", "not muted", "already banned"
   should be explicit, non-scary errors.
9. **Produce readable CV2 output.** Use `embed({ title, description, fields,
   color, thumb, footer })` for structured results. Keep titles short, values
   informative, timestamps via `stamp()`. No walls of text; truncate with
   `truncate`.
10. **Never crash the handler.** Wrap multi-step external calls so one failure
    does not lose the whole result. Let the registry catch truly unexpected
    errors, but handle expected ones yourself.
11. **Be concise to the user.** A successful one-line action returns one line;
    a listing returns a clean container.

## Output conventions

- Success: `ok(\`Banned **${tagOf(target.user)}** · case #${c.id}\`)`
- Listing: `ok(embed({ title: 'bans · 12', description: listBody(lines), color: COLOR.mod }))`
- Error: lowercase, direct, actionable (`'that member is not in the server.'`)
- Use mentions `<@id>`, `<#id>`, `<@&id>` and `<t:...>` timestamps.
- Colors: `COLOR.ok/err/info/warn/mod/neutral` from `../lib/render.js`.

## Quality checklist before you finish

- [ ] Every command has input validation and a precise error path.
- [ ] Hierarchy/self/owner guards wherever a member is acted on.
- [ ] Bot permission preflight with named missing perms.
- [ ] Case logging consistent with existing calls.
- [ ] Target DM where it makes sense; failures ignored.
- [ ] Bulk actions report counts and skip un-actionable targets.
- [ ] No `content`/`embeds` at payload root.
- [ ] `node --check src/commands/<file>.js` passes.
- [ ] No imports from files other than `discord.js`, `../lib/*`, `./helpers.js`,
      `./shared.js`, and `../features/*` where already used.

## Verify

Run:

```bash
cd /wellix && node --check src/commands/<your-file>.js
```

Then re-read your file once, top to bottom, checking each command against the
checklist. Improve anything that still feels thin. Report a short summary of what
you changed per command.
