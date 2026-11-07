// PROTOTYPE, throwaway. Minimal WeChat ClawBot (iLink) client, text only.
// Endpoints / headers / body shapes copied from the MIT-licensed
// @tencent-weixin/openclaw-weixin v2.4.10 (Tencent), src/api/api.ts + src/auth/login-qr.ts.
import { randomBytes, randomUUID } from "node:crypto";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const VERSION = "2.4.10"; // ref package.json version; ilink_appid = "bot"
const CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10); // 0x00MMNNPP
const BASE_INFO = { channel_version: VERSION, bot_agent: "CodiPrototype/0.0.1" };

const common = { "iLink-App-Id": "bot", "iLink-App-ClientVersion": CLIENT_VERSION };
const uin = () => Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64");

async function post(
  base: string,
  endpoint: string,
  body: object,
  token?: string,
  timeoutMs = 15_000,
) {
  const res = await fetch(new URL(endpoint, base.replace(/\/?$/, "/")), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": uin(),
      ...common,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...body, base_info: BASE_INFO }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`);
  // message_id is uint64; we never use it, so plain JSON.parse is fine here.
  return JSON.parse(text);
}

export type Account = { token: string; baseUrl: string; userId?: string };
export type Inbound = { from: string; text: string; contextToken?: string };

/** Long-poll. Client-side timeout is normal (returns no msgs). Throws on network errors. */
export async function getUpdates(acc: Account, buf: string) {
  try {
    return (await post(
      acc.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: buf },
      acc.token,
      40_000,
    )) as {
      ret?: number;
      errcode?: number;
      errmsg?: string;
      get_updates_buf?: string;
      longpolling_timeout_ms?: number;
      msgs?: {
        from_user_id?: string;
        message_type?: number;
        context_token?: string;
        item_list?: {
          type?: number;
          text_item?: { text?: string };
          voice_item?: { text?: string };
        }[];
      }[];
    };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError")
      return { ret: 0, msgs: [], get_updates_buf: buf };
    throw e;
  }
}

/** Text of a USER message (type 1) incl. voice-to-text; undefined for anything else. */
export function textOf(m: NonNullable<Awaited<ReturnType<typeof getUpdates>>["msgs"]>[number]) {
  if (m.message_type !== 1) return undefined;
  const t = (m.item_list ?? [])
    .map((i) => (i.type === 1 ? i.text_item?.text : i.type === 3 ? i.voice_item?.text : "") ?? "")
    .join("\n")
    .trim();
  return t || undefined;
}

/** Reply text. Must carry the context_token of the inbound message. */
export async function sendText(acc: Account, to: string, text: string, contextToken?: string) {
  const r = await post(
    acc.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: `openclaw-weixin:${Date.now()}-${randomUUID().slice(0, 8)}`,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
    },
    acc.token,
  );
  if (r.ret) throw new Error(`sendmessage ret=${r.ret} errmsg=${r.errmsg}`);
}

/** QR login. Returns the new account + ilink_bot_id (account id). One scan = one bot account bound to the scanner. */
export async function qrLogin(
  existingTokens: string[],
  showQr: (url: string) => Promise<void> | void,
  askCode: (p: string) => Promise<string>,
) {
  const fetchQr = () =>
    post(DEFAULT_BASE_URL, "ilink/bot/get_bot_qrcode?bot_type=3", {
      local_token_list: existingTokens,
    }) as Promise<{ qrcode: string; qrcode_img_content: string }>;
  let qr = await fetchQr();
  await showQr(qr.qrcode_img_content);
  let base = DEFAULT_BASE_URL,
    refreshes = 1,
    verify: string | undefined;
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    let st: any;
    try {
      const url = new URL(
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}${verify ? `&verify_code=${encodeURIComponent(verify)}` : ""}`,
        base + "/",
      );
      const res = await fetch(url, { headers: common, signal: AbortSignal.timeout(35_000) });
      st = JSON.parse(await res.text());
    } catch {
      st = { status: "wait" };
    } // timeout / gateway error => keep polling (as ref does)
    console.log(`[login] status=${st.status}`);
    if (st.status === "scaned") verify = undefined;
    if (st.status === "need_verifycode") {
      verify = await askCode(verify ? "数字不匹配，重新输入：" : "输入手机微信显示的数字：");
      continue;
    }
    if (st.status === "scaned_but_redirect" && st.redirect_host)
      base = `https://${st.redirect_host}`;
    if (st.status === "expired" || st.status === "verify_code_blocked") {
      if (++refreshes > 3) throw new Error("QR expired 3 times");
      qr = await fetchQr();
      verify = undefined;
      await showQr(qr.qrcode_img_content);
    }
    if (st.status === "binded_redirect")
      throw new Error("already bound to this client (binded_redirect)");
    if (st.status === "confirmed") {
      if (!st.ilink_bot_id) throw new Error("confirmed but no ilink_bot_id");
      return {
        id: st.ilink_bot_id as string,
        acc: {
          token: st.bot_token,
          baseUrl: st.baseurl || DEFAULT_BASE_URL,
          userId: st.ilink_user_id,
        } as Account,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("login timeout");
}
