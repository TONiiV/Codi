# Codi x WeChat ClawBot (PROTOTYPE, wipe me)

Run: `bun prototype/wechat-bot/bot.ts [--transport=cli|weixin|wecom] [--login] [--config=path]`

- `cli` (default): terminal REPL. `@alice 绑定 TEST1`, then `@alice <text>`; user is sticky. Replies print as `[bot → alice] ...`.
- `weixin --login`: QR login (URL printed; QR drawn if `qrcode-terminal` happens to be installed), saves token to `.state/ilink.json`, then long-polls. Run `--login` again to add another account. Without `--login`: just polls saved accounts.
- Config: `.state/config.json` (copy `config.example.json`; falls back to the example). State (`state.json` bindings + Codi bearers, `ilink.json`, `buf-*.txt` cursors) lives in `.state/` (gitignored, delete freely).
- Environments: `{id,label,url, pairingUrl | token}`. Profile `work.modelSelection` is the real `ModelSelection` shape (`instanceId`, `model`, `options:[{id:"effort",value}]`).
- Fixed commands (no model): `确认 [id]` `取消 [id]` `进度 [id]` `停止 id` `绑定 <邀请码>` `帮助`. Anything else goes to `assistant.command` (default `claude -p --output-format json --model sonnet`, prompt on stdin).

## WeCom (企业微信智能机器人, `--transport=wecom`)

Run: `bun prototype/wechat-bot/bot.ts --transport=wecom` (config `wecom: { botId, secret }` in `.state/config.json`; optional `url` override for testing, default `wss://openws.work.weixin.qq.com`).

- Create the bot: WeCom admin console -> create a 智能机器人 in API mode with the 长连接 (long connection) receive method, then copy its **Bot ID** and **Secret** (plugin README only says "enter the bot's Bot ID and Secret"; the exact console menu names are from the WeCom docs and UNVERIFIED here).
- Multi-user: unlike ClawBot (one QR login = one account = one user), ONE bot serves many members. Sender key is `wecom:<from.userid>`; each member sends `绑定 <邀请码>` once, same profile mechanism.
- Groups: add the bot to a group and @ it. Replies go to that chat; proposals made in a group remember the chat, so the completion notice returns there. `确认/取消/进度/停止` stay bound to the sender + id. Leading `@name` is stripped. Invite codes typed in a group are visible to the group.
- Replies to an inbound message use `aibot_respond_msg` with the callback's `req_id` (one finished stream frame, first reply only); everything else (10s poll task-complete notices, 2nd reply, failed respond) uses `aibot_send_msg` markdown to `chatid` = userid (single) or group chatid.
- Gaps: text/voice-to-text/mixed-text only (no media, welcome msg, template cards); no streaming progress, so the user sees nothing until the router finishes (up to 180s); proactive push only works to chats the bot recently talked to (plugin README), window length UNVERIFIED; "only @-mentions are delivered in groups" is assumed from the plugin (it applies no mention filter itself), unverified; a second connection with the same bot kicks the first (`disconnected_event`, bot then stops instead of reconnecting). Verified only against a local mock server, never real WeCom.

## Finding: multi-user in ClawBot

One QR login = one bot account (`ilink_bot_id`) bound to exactly ONE WeChat user (the scanner, returned as `ilink_user_id`). Multiple users = multiple logins/accounts, each polled separately.

- `login-qr.ts:61-62,472` status response carries `ilink_user_id` = "the person who scanned"; `login-qr.ts:459-473` account id = `ilink_bot_id`.
- `accounts.ts:56-61` account index is a list of ids; `accounts.ts:90-110` `clearStaleAccountsForUserId`: a new login for the same user REPLACES the older account (one account per user); `channel.ts:450-458` calls it after login.
- `login-qr.ts:81-92` `local_token_list` (up to 10 tokens of existing accounts) is sent to `get_bot_qrcode`; README.md:75-81 "Run the login command again for each account".
- `authorization.ts:20-36` inbound is gated by `allowFrom` = the bound userId (pairing policy), so an account only serves its owner.
  Implementation here: `ilink.json` holds N accounts, one poll loop each; sender key = inbound `from_user_id`; replies go through the account + latest `context_token` of that sender. Config users are _profiles_; a sender becomes a profile via `绑定 <code>`.

## Codi side

- Bearer from pairing URL (same as web: `packages/shared/src/remote.ts` + `client-runtime/.../authorization/remote.ts:116`): read `token` from URL hash (or query) -> `POST {url}/oauth/token` form-urlencoded `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<token>`, `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`, `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, `scope=orchestration:read orchestration:operate` -> `access_token`, cached in `state.json`. **DPoP is optional**: without a `DPoP` header the server issues a plain `Bearer` (`auth/http.ts:295`, `EnvironmentAuth.ts:605-640`; only DPoP-bound tokens require proofs). Pairing tokens are one-time: if the cached bearer gets a 401 the cache is cleared and you need a fresh pairing URL/token.
- Used endpoints: `/.well-known/t3/environment` (online probe), `GET /api/orchestration/shell` (projects = the only routing candidates), `POST /api/orchestration/dispatch` (`thread.create`, `thread.turn.start`, `thread.turn.interrupt`), `GET /api/orchestration/threads/:id?turnLimit=1` (10s polling).

## Trial checklist

1. `cp config.example.json .state/config.json`; fill env urls + pairingUrl/token (mint with `node apps/server/src/bin.ts pair` on each machine).
2. `bun prototype/wechat-bot/bot.ts` -> `@alice 绑定 TEST1`, `@alice 1+1等于几` (answer), forward-style work message (proposal), `@bob 确认 <alice's id>` (must be refused), `@alice 改成只调查` (revised proposal), `@alice 确认`, wait for result.
3. `--transport=weixin --login` with your phone; ask a friend to do a second `--login` on their own WeChat.
4. Kill/stop the target Codi server and ask again: bot must say offline and not switch machines.

## Open gaps

- Providers/models/effort options are only exposed over WS RPC (`rpc.ts` server config), not HTTP; profiles are static config, router can't discover what is installed on each machine.
- Polling every 10s, not a WS subscription. No pending approvals / user-input prompts surfaced (threads run `full-access`, so "investigate only" is enforced by prompt, not sandbox).
- iLink `context_token` is reused for proactive task-complete messages; whether it expires is UNVERIFIED (needs a real phone). Replies are not chunked; no media; text only. Pending proposals/tasks are lost on restart. `-14` session-expired just logs.
- Hosted pairing URLs (`?host=` form) are not parsed; use direct `url` + token.
- iLink client headers copy the official plugin (`iLink-App-Id: bot`, version 2.4.10); real-network login/send never run here.
