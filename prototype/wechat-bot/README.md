# Codi x WeChat ClawBot (PROTOTYPE, wipe me)

Run: `bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path] [--state=dir]` (`--state` defaults to `.state/`)

- `cli` (default): terminal REPL. `@root 绑定 <bootstrapCode>`, then `@root <text>`; the `@name` is sticky and becomes account `cli:name`. Replies print as `[bot → cli:root] ...`.
- `weixin --login`: QR login (URL printed; QR drawn if `qrcode-terminal` happens to be installed), saves token to `.state/ilink.json`, then long-polls. Run `--login` again to add another account. Without `--login`: just polls saved accounts.
- Config: `.state/config.json` (copy `config.example.json`; falls back to the example). State (`members.json`, `state.json` Codi bearers + reply routes, `ilink.json`, `buf-*.txt` cursors) lives in `.state/` (gitignored, delete freely).
- Environments: `{id,label,url, pairingUrl | token}`. `defaultWork.modelSelection` is the real `ModelSelection` shape (`instanceId`, `model`, `options:[{id:"effort",value}]`); each new member gets a copy (edit `members.json` to give one member another model / `lockModel`).
- Fixed commands (no model): `确认 [id]` `取消 [id]` `进度 [id]` `停止 id` `帮助`, plus `绑定 <邀请码>` for unbound accounts and the admin commands below. Anything else goes to `assistant.command` (default `claude -p --output-format json --model sonnet`, prompt on stdin).

## WeCom (企业微信智能机器人, `--transport=wecom`)

Run: `bun prototype/wechat-bot/bot.ts --transport=wecom` (config `wecom: { botId, secret }` in `.state/config.json`; optional `url` override for testing, default `wss://openws.work.weixin.qq.com`).

- Create the bot: WeCom admin console -> create a 智能机器人 in API mode with the 长连接 (long connection) receive method, then copy its **Bot ID** and **Secret** (plugin README only says "enter the bot's Bot ID and Secret"; the exact console menu names are from the WeCom docs and UNVERIFIED here).
- Multi-user: unlike ClawBot (one QR login = one account = one user), ONE bot serves many members. Account is `wecom:<from.userid>`; each member sends `绑定 <邀请码>` once from their own WeCom account.
- Groups: add the bot to a group and @ it. Replies go to that chat; proposals made in a group remember the chat, so the completion notice returns there. `确认/取消/进度/停止` stay bound to the sender + id. Leading `@name` is stripped. Invite codes are never issued in a group (`请私聊我获取邀请码`); a code typed in a group is visible to it but single-use.
- Replies to an inbound message use `aibot_respond_msg` with the callback's `req_id` (one finished stream frame, first reply only); everything else (10s poll task-complete notices, 2nd reply, failed respond) uses `aibot_send_msg` markdown to `chatid` = userid (single) or group chatid.
- Gaps: text/voice-to-text/mixed-text only (no media, welcome msg, template cards); no streaming progress, so the user sees nothing until the router finishes (up to 180s); proactive push only works to chats the bot recently talked to (plugin README), window length UNVERIFIED; "only @-mentions are delivered in groups" is assumed from the plugin (it applies no mention filter itself), unverified; a second connection with the same bot kicks the first (`disconnected_event`, bot then stops instead of reconnecting). Verified only against a local mock server, never real WeCom.

## Members, accounts, grants (admin model)

Default deny. Nobody reaches a project unless an admin granted it.

- **Member** = a person: `{id, name, role: admin|member, grants[], work}`. Admin is a role (can run the commands below); it does NOT imply project access, an admin also needs grants to command projects (use `<env>/*`). Admins can see/stop every task.
- **Channel account** = `<channel>:<native id>` (`weixin:<from_user_id>`, `wecom:<userid>`, `cli:<name>`). Each account maps to exactly one member; one member may have many accounts (their WeChat + their WeCom). Unknown account: only `绑定 <code>` works. Bound member without grants sees no projects (router gets zero candidates, replies `请联系管理员授权`).
- **Grant** = `{environmentId, projectId, access: read|write}`. `projectId:"*"` = every project in that environment (admin convenience, shown as `[全部项目]`). Grants are the only source of visibility.
- Persistence: `.state/members.json`. Config only seeds it when the file does not exist: `admins: ["cli:alice", "weixin:...", ...]` become admin members; `bootstrapCode` is a one-time code, the first `绑定 <code>` creates an admin member named after the account. Config `invites`/`users` are gone.
- Filter before the model: the router prompt only lists granted projects (with `access`). `validate()` re-checks env/project against grants after, and `确认` re-checks again (a revoked grant voids a pending proposal).

| access | may do                                                                                                                                                       | enforcement                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| read   | ask about the project, see progress/results, scope `investigate` only. A fix/full request is downgraded and says so (`你对 Codi 只有只读权限，已改为只调查`) | thread created and turn started with `interactionMode:"plan"` + `runtimeMode:"approval-required"` (runtime, not just prompt) |
| write  | confirm `fix`/`full`, `停止` own tasks                                                                                                                       | `full-access` / `default` as before                                                                                          |

`进度`/`停止`: a member only sees their own tasks; admin sees/stops all. `停止` needs write on that project (or admin).

Admin commands (fixed, no model call, admin only; others get `需要管理员权限`). Every change echoes the member's resulting state.

| forward                               | reverse                               | notes                                                                                                                                  |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `新成员 <名字>`                       | `删除成员 <成员>`                     | creates member + one-time code (24h); delete removes member + accounts + invites; running tasks keep running, owner no longer notified |
| `邀请 <成员>`                         | (code expires after 24h / single use) | extra code to link another account; `新成员`/`邀请` refused in a WeCom group (`请私聊我获取邀请码`)                                    |
| `授权 <成员> <环境>/<项目或*> 读或写` | `撤权 <成员> <环境>/<项目或*>`        | env by id or label; project by id or unique title; re-grant changes the level                                                          |
| (`绑定 <code>`)                       | `解绑 <账号>`                         | refused if it strands the last admin                                                                                                   |
| `设为管理员 <成员>`                   | `取消管理员 <成员>`                   | last admin cannot be removed/deleted/unbound                                                                                           |
| `成员` / `项目`                       |                                       | list members + accounts + grants / list all environments + projects (live) with ids                                                    |

`帮助` shows member commands to everyone and adds the admin block for admins.

## Finding: multi-user in ClawBot

One QR login = one bot account (`ilink_bot_id`) bound to exactly ONE WeChat user (the scanner, returned as `ilink_user_id`). Multiple users = multiple logins/accounts, each polled separately.

- `login-qr.ts:61-62,472` status response carries `ilink_user_id` = "the person who scanned"; `login-qr.ts:459-473` account id = `ilink_bot_id`.
- `accounts.ts:56-61` account index is a list of ids; `accounts.ts:90-110` `clearStaleAccountsForUserId`: a new login for the same user REPLACES the older account (one account per user); `channel.ts:450-458` calls it after login.
- `login-qr.ts:81-92` `local_token_list` (up to 10 tokens of existing accounts) is sent to `get_bot_qrcode`; README.md:75-81 "Run the login command again for each account".
- `authorization.ts:20-36` inbound is gated by `allowFrom` = the bound userId (pairing policy), so an account only serves its owner.
  Implementation here: `ilink.json` holds N accounts, one poll loop each; account = `weixin:<from_user_id>`; replies go through the iLink login + latest `context_token` of that sender. A weixin account becomes a member's account via `绑定 <code>`.

## Codi side

- Bearer from pairing URL (same as web: `packages/shared/src/remote.ts` + `client-runtime/.../authorization/remote.ts:116`): read `token` from URL hash (or query) -> `POST {url}/oauth/token` form-urlencoded `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<token>`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`, `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, `scope=orchestration:read orchestration:operate` -> `access_token`, cached in `state.json`. **DPoP is optional**: without a `DPoP` header the server issues a plain `Bearer` (`auth/http.ts:295`, `EnvironmentAuth.ts:605-640`; only DPoP-bound tokens require proofs). Pairing tokens are one-time: if the cached bearer gets a 401 the cache is cleared and you need a fresh pairing URL/token.
- Used endpoints: `/.well-known/t3/environment` (online probe), `GET /api/orchestration/shell` (projects = the only routing candidates), `POST /api/orchestration/dispatch` (`thread.create`, `thread.turn.start`, `thread.turn.interrupt`), `GET /api/orchestration/threads/:id?turnLimit=1` (10s polling).

## Trial checklist

1. `cp config.example.json .state/config.json`; fill env urls + pairingUrl/token, `admins`/`bootstrapCode` (mint with `node apps/server/src/bin.ts pair` on each machine).
2. `bun prototype/wechat-bot/bot.ts` -> `@root 绑定 <bootstrapCode>`, `@root 新成员 bob`, `@root 授权 bob <环境>/<项目> 读`, `@bob 绑定 <code>`, `@bob 1+1等于几` (answer), work message (read-only => investigate proposal), `@bob 确认`, `@root 授权 bob ... 写`, ask again (fix), `@bob 确认`, `@root 撤权 ...`.
3. `--transport=weixin --login` with your phone; ask a friend to do a second `--login` on their own WeChat.
4. Kill/stop the target Codi server and ask again: bot must say offline and not switch machines.

## Open gaps

- Providers/models/effort options are only exposed over WS RPC (`rpc.ts` server config), not HTTP; profiles are static config, router can't discover what is installed on each machine.
- Polling every 10s, not a WS subscription. No pending approvals / user-input prompts surfaced (write tasks run `full-access`, so scope `investigate` for a write member is prompt-only; read members get `plan` + `approval-required`, and an approval prompt would just sit there since the bot cannot answer it).
- iLink `context_token` is reused for proactive task-complete messages; whether it expires is UNVERIFIED (needs a real phone). Replies are not chunked; no media; text only. Pending proposals/tasks are lost on restart. `-14` session-expired just logs.
- Hosted pairing URLs (`?host=` form) are not parsed; use direct `url` + token.
- iLink client headers copy the official plugin (`iLink-App-Id: bot`, version 2.4.10); real-network login/send never run here.
- **Permissions: enforcement lives in the bot, not the Codi server.** The bot's own Codi bearer has full `orchestration:operate`; anyone who steals it (or `.state/state.json`) bypasses every grant. A real version needs server-side scoped credentials per member (or per-project tokens) so Codi itself refuses out-of-grant commands.
- Group chats: the sender is still the member's account, but replies go to the group, so proposals/progress/results are visible to everyone there; admin commands other than invites are allowed in groups. Invite codes are 32-bit random with no attempt throttle. No `撤销邀请` (wait for expiry or delete the member). Admin role does not imply project access (deliberate). Tasks started before a grant was revoked keep running; only notifications/progress stop. Members cannot be renamed; per-member model/effort is only editable in `members.json`.
