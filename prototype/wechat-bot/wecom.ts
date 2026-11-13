// PROTOTYPE, throwaway. Minimal WeCom (企业微信) 智能机器人 long-connection client, text only.
// Frame shapes / URL / heartbeat / backoff copied from the MIT-licensed
// @wecom/aibot-node-sdk v1.0.7 (Tencent / WeCom), dist/index.esm.js.
import { randomBytes } from "node:crypto";

export const DEFAULT_URL = "wss://openws.work.weixin.qq.com"; // sdk index.esm.js:197
const HEARTBEAT_MS = 30_000; // :910
const MAX_MISSED_PONG = 2; // :215
const ACK_TIMEOUT_MS = 5000; // :229
const MAX_CONTENT = 6000; // stream content <= 20480 UTF-8 bytes (api.d.ts:84); 3 bytes/CJK char

export type Inbound = {
  reqId: string;
  userid: string;
  /** set only for group chats (body.chattype === "group") */
  chatid?: string;
  text: string;
};

// sdk :190 generateReqId(prefix) => `${prefix}_${Date.now()}_${8 hex}`
const reqIdOf = (prefix: string) => `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;

type Cfg = { botId: string; secret: string; url?: string };

export function connect(cfg: Cfg, onMessage: (m: Inbound) => void) {
  let ws: WebSocket | undefined;
  let hb: ReturnType<typeof setInterval> | undefined;
  let missed = 0;
  let attempts = 0;
  let closed = false;
  const seen = new Set<string>(); // body.msgid is "for dedupe" (sdk message.d.ts:96)
  const pending = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const raw = (frame: object) => {
    if (ws?.readyState !== WebSocket.OPEN) throw new Error("wecom ws not connected");
    ws.send(JSON.stringify(frame));
  };
  /** Send a frame and wait for its ack `{headers:{req_id}, errcode, errmsg}` (sdk :1500-ish sendReply). */
  const call = (cmd: string, reqId: string, body: object) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error(`ack timeout ${cmd}`));
      }, ACK_TIMEOUT_MS);
      pending.set(reqId, { resolve, reject, timer });
      try {
        raw({ cmd, headers: { req_id: reqId }, body });
      } catch (e: any) {
        clearTimeout(timer);
        pending.delete(reqId);
        reject(e);
      }
    });

  const open = () => {
    console.log(`[wecom] connecting ${cfg.url ?? DEFAULT_URL}`);
    const w = (ws = new WebSocket(cfg.url ?? DEFAULT_URL));
    w.onopen = () => {
      missed = 0;
      // sdk :341-356
      raw({
        cmd: "aibot_subscribe",
        headers: { req_id: reqIdOf("aibot_subscribe") },
        body: { bot_id: cfg.botId, secret: cfg.secret },
      });
    };
    w.onmessage = (ev) => {
      let f: any;
      try {
        // sdk :301 strips control chars before JSON.parse
        f = JSON.parse(String(ev.data).replace(/[\x00-\x08\x0B-\x0D\x0E-\x1F]/g, ""));
      } catch {
        return;
      }
      const rid: string = f.headers?.req_id ?? "";
      if (f.cmd === "aibot_msg_callback") {
        const b = f.body ?? {};
        if (!b.msgid || seen.has(b.msgid)) return;
        seen.add(b.msgid);
        if (seen.size > 500) seen.delete(seen.values().next().value!);
        const text =
          b.msgtype === "text"
            ? b.text?.content
            : b.msgtype === "voice"
              ? b.voice?.content // server-side speech-to-text
              : b.msgtype === "mixed"
                ? (b.mixed?.msg_item ?? [])
                    .filter((i: any) => i.msgtype === "text")
                    .map((i: any) => i.text?.content ?? "")
                    .join("\n")
                : undefined;
        const userid = b.from?.userid;
        if (!text?.trim() || !userid) return;
        onMessage({
          reqId: rid,
          userid,
          chatid: b.chattype === "group" ? b.chatid : undefined,
          text,
        });
        return;
      }
      if (f.cmd === "aibot_event_callback") {
        // sdk :376-398: disconnected_event = a newer connection took over; do NOT reconnect.
        if (f.body?.event?.eventtype === "disconnected_event") {
          console.log(
            "[wecom] kicked by a newer connection (disconnected_event); not reconnecting",
          );
          closed = true;
          w.close();
        }
        return;
      }
      // no-cmd frames: auth / ping ack / reply ack, told apart by req_id prefix (sdk :399-440)
      if (rid.startsWith("aibot_subscribe")) {
        if (f.errcode !== 0) {
          console.log(`[wecom] auth failed errcode=${f.errcode} ${f.errmsg}`);
          return w.close();
        }
        console.log("[wecom] authenticated");
        attempts = 0;
        clearInterval(hb);
        hb = setInterval(() => {
          if (missed >= MAX_MISSED_PONG) return w.close();
          missed++;
          try {
            raw({ cmd: "ping", headers: { req_id: reqIdOf("ping") } });
          } catch {}
        }, HEARTBEAT_MS);
        return;
      }
      if (rid.startsWith("ping")) {
        if (f.errcode === 0) missed = 0;
        return;
      }
      const p = pending.get(rid);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(rid);
        f.errcode === 0 ? p.resolve() : p.reject(new Error(`errcode=${f.errcode} ${f.errmsg}`));
      }
    };
    w.onerror = () => {};
    w.onclose = () => {
      clearInterval(hb);
      for (const [k, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("ws closed"));
        pending.delete(k);
      }
      if (closed) return;
      // sdk :527 exponential backoff 1s..30s (prototype: retry forever)
      const delay = Math.min(1000 * 2 ** attempts++, 30_000);
      console.log(`[wecom] closed; reconnect in ${delay}ms`);
      setTimeout(open, delay);
    };
  };
  open();

  return {
    /** Passive reply to a callback: aibot_respond_msg echoing the callback's req_id, one finished stream frame (sdk :1016 replyStream). */
    respond: (reqId: string, text: string) =>
      call("aibot_respond_msg", reqId, {
        msgtype: "stream",
        stream: { id: reqIdOf("stream"), finish: true, content: text.slice(0, MAX_CONTENT) },
      }),
    /** Proactive push: aibot_send_msg, chatid = userid (single) or chatid (group), fresh req_id (sdk :1150-1155). */
    send: (chatid: string, text: string) =>
      call("aibot_send_msg", reqIdOf("aibot_send_msg"), {
        chatid,
        msgtype: "markdown",
        markdown: { content: text.slice(0, MAX_CONTENT) },
      }),
  };
}
