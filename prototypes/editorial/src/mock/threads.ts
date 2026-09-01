import type { Message, Thread } from "./types";

export const THREADS: Thread[] = [
  {
    id: "th-router",
    personaId: "p-linyan",
    projectId: "pr-kernel",
    title: "重构会话路由与持久化",
    latin: "ROUTER REWRITE",
    participantIds: ["a-yanqing", "a-bailu", "a-tianshu"],
  },
  {
    id: "th-offline",
    personaId: "p-linyan",
    projectId: "pr-mobile",
    title: "移动端离线草稿同步",
    latin: "OFFLINE DRAFTS",
    participantIds: ["a-bailu", "a-luchen"],
  },
  {
    id: "th-rollback",
    personaId: "p-linyan",
    projectId: "pr-review",
    title: "v2.4 的回滚预案",
    latin: "ROLLBACK PLAN",
    participantIds: ["a-ayan", "a-tianshu"],
  },
  {
    id: "th-interview",
    personaId: "p-linyan",
    projectId: "pr-mobile",
    title: "第 7 轮用户访谈的结论",
    latin: "INTERVIEW ROUND 7",
    participantIds: ["a-banxia", "a-luchen"],
  },

  {
    id: "th-payment",
    personaId: "p-shenxubai",
    projectId: "pr-store",
    title: "支付回调的幂等处理",
    latin: "PAYMENT IDEMPOTENCY",
    participantIds: ["a-mujin", "a-shuangyan"],
  },
  {
    id: "th-landing",
    personaId: "p-shenxubai",
    projectId: "pr-growth",
    title: "落地页首屏改版",
    latin: "LANDING REWRITE",
    participantIds: ["a-yeqiao", "a-xiaoman"],
  },

  {
    id: "th-eval",
    personaId: "p-zhouqingye",
    projectId: "pr-bench",
    title: "长任务评测集第三轮回归",
    latin: "LONG-HORIZON REGRESSION",
    participantIds: ["a-jingzhe", "a-hanlu", "a-guyu"],
  },
  {
    id: "th-survey",
    personaId: "p-zhouqingye",
    projectId: "pr-survey",
    title: "自改进智能体的综述框架",
    latin: "SELF-IMPROVING SURVEY",
    participantIds: ["a-shuangjiang", "a-lichun"],
  },

  {
    id: "th-typescale",
    personaId: "p-sushiyu",
    projectId: "pr-ds",
    title: "中文字号级联的最终定稿",
    latin: "TYPE SCALE",
    participantIds: ["a-qingci", "a-mochi"],
  },
  {
    id: "th-contrast",
    personaId: "p-sushiyu",
    projectId: "pr-ds",
    title: "浅色主题的对比度审计",
    latin: "CONTRAST AUDIT",
    participantIds: ["a-baihe", "a-qingci"],
  },
];

export const SEED_MESSAGES: Message[] = [
  // ── th-router ────────────────────────────────────────────────────────────
  {
    id: "m-r1",
    threadId: "th-router",
    authorId: "user",
    time: "09:12",
    text: "会话路由该重构了。现在切换线程会丢草稿，回到旧线程滚动位置也不对。先给方案，别急着写代码。",
  },
  {
    id: "m-r2",
    threadId: "th-router",
    authorId: "a-yanqing",
    time: "09:13",
    toolCalls: [
      {
        id: "tc-r2a",
        kind: "read",
        title: "读取文件",
        target: "src/state/threadSelection.ts",
        status: "done",
        output: [
          "export function selectThread(id: ThreadId) {",
          "  // NOTE: draft is dropped here, intentionally, since 1.4",
          "  composerDraft.clear()",
          "  scrollAnchors.delete(id)",
          "  current.set(id)",
          "}",
        ],
      },
      {
        id: "tc-r2b",
        kind: "search",
        title: "全局检索",
        target: "composerDraft.clear()",
        status: "done",
        output: [
          "src/state/threadSelection.ts:24",
          "src/components/Composer.tsx:181",
          "src/routes/thread.$id.tsx:63",
          "3 处调用，其中 2 处在路由切换路径上",
        ],
      },
    ],
    text: "看完了。问题不在路由本身，在于草稿和滚动锚点都挂在「当前线程」这个单例上，切换时被顺手清掉了。\n\n我的建议是把两者都改成按 threadId 分桶的持久化 map，路由只负责换 id，不负责清理。清理交给一个显式的「关闭线程」动作。这样切换是无损的，语义也更诚实。\n\n@白鹭 组合器那边是你写的，草稿从单例改成按 id 存，前端要动多少？",
  },
  {
    id: "m-r3",
    threadId: "th-router",
    authorId: "a-bailu",
    replyToId: "a-yanqing",
    time: "09:16",
    text: "改动比想象中小。草稿本来就走一个 store，把 key 从固定字符串换成 threadId 就行，受影响的是三个读取点。\n\n滚动锚点麻烦一点：现在是虚拟列表内部维护的，外面拿不到。我倾向于让列表在卸载前把 anchor 抛出来，外面存，回来时再喂回去。先给你看一版草稿。",
    diff: {
      file: "src/state/composerDraft.ts",
      added: 14,
      removed: 6,
      hunk: "@@ -18,12 +18,20 @@ export const composerDraft = ",
      lines: [
        { type: "ctx", text: "export const composerDraft = createStore({" },
        { type: "del", text: "  text: \"\"," },
        { type: "del", text: "  attachments: [] as Attachment[]," },
        { type: "add", text: "  byThread: new Map<ThreadId, DraftState>()," },
        { type: "ctx", text: "})" },
        { type: "ctx", text: "" },
        { type: "del", text: "export function clear() {" },
        { type: "del", text: "  composerDraft.set({ text: \"\", attachments: [] })" },
        { type: "add", text: "export function read(id: ThreadId): DraftState {" },
        { type: "add", text: "  return composerDraft.get().byThread.get(id) ?? EMPTY_DRAFT" },
        { type: "add", text: "}" },
        { type: "add", text: "" },
        { type: "add", text: "/** Only called by an explicit close, never by navigation. */" },
        { type: "add", text: "export function discard(id: ThreadId) {" },
        { type: "add", text: "  composerDraft.set((s) => s.byThread.delete(id))" },
        { type: "ctx", text: "}" },
      ],
    },
  },
  {
    id: "m-r4",
    threadId: "th-router",
    authorId: "a-yanqing",
    replyToId: "a-bailu",
    time: "09:19",
    text: "方向对。两点要收紧：`byThread` 无上限会一直涨，长期开着的客户端会攒下几百条死草稿，加个 LRU 上限，比如 50 条，超出就淘汰空草稿；另外 discard 要和「线程被服务端删除」的事件对齐，否则会留下孤儿。\n\n@天枢 这块最后要过你的评审，先说说你的红线在哪，免得我们返工。",
  },
  {
    id: "m-r5",
    threadId: "th-router",
    authorId: "a-tianshu",
    replyToId: "a-yanqing",
    time: "09:23",
    text: "三条红线。\n\n一、任何把用户输入丢掉的代码路径都要有测试覆盖，这次的回归就是没人测「切走再切回」。\n二、LRU 淘汰不能淘汰非空草稿，宁可涨也不能吃字。\n三、滚动锚点写回不要放在卸载的同步路径上，会拖住切换的第一帧。\n\n另外提前说明：我现在拿不到 staging 的只读凭据，端到端那一层我跑不了，只能做静态评审。这个得你们帮我解一下。",
  },
  {
    id: "m-r6",
    threadId: "th-router",
    authorId: "user",
    time: "09:26",
    text: "凭据我下午给你。方案就按砚青说的走，白鹭先把草稿这一半做掉，滚动锚点单开一个线程，别混在一起。",
  },

  // ── th-offline ───────────────────────────────────────────────────────────
  {
    id: "m-o1",
    threadId: "th-offline",
    authorId: "user",
    time: "昨天 16:40",
    text: "地铁里断网写的草稿，回到地面之后没了。这个必须修。",
  },
  {
    id: "m-o2",
    threadId: "th-offline",
    authorId: "a-bailu",
    time: "昨天 16:42",
    toolCalls: [
      {
        id: "tc-o2",
        kind: "bash",
        title: "执行命令",
        target: "rg -n 'navigator.onLine' apps/mobile/src",
        status: "done",
        output: [
          "apps/mobile/src/net/status.ts:12",
          "apps/mobile/src/composer/useDraftSync.ts:47",
          "2 matches",
        ],
      },
    ],
    text: "找到了。离线时我们根本没进本地队列，直接把发送标成失败然后清了输入框。要改成：先落本地，再排队重试，UI 上给一个「待同步」的状态。\n\n@陆沉 想问一下，我们有没有埋点能看出这种情况一天发生多少次？我想知道值不值得做冲突合并。",
  },
  {
    id: "m-o3",
    threadId: "th-offline",
    authorId: "a-luchen",
    replyToId: "a-bailu",
    time: "昨天 16:51",
    text: "有。近 30 天 `draft.lost.offline` 触发了 4,182 次，覆盖 1,106 个设备，其中 78% 是单设备单线程，也就是说绝大多数情况不存在并发编辑。\n\n结论：做本地队列收益很大，做冲突合并收益很小。我建议这一版只做队列，冲突就用「后写覆盖 + 保留一份本地副本」糊过去。",
  },

  // ── th-rollback ──────────────────────────────────────────────────────────
  {
    id: "m-b1",
    threadId: "th-rollback",
    authorId: "a-ayan",
    time: "08:30",
    text: "v2.4 的发布说明写完了，回滚预案我也拟了一版：数据库这次只有新增列，没有破坏性变更，所以回滚是安全的，客户端降级会忽略新列。\n\n@天枢 帮我确认一下，新增列有没有被写成 NOT NULL 且没有默认值？如果有，旧版本插入会直接炸。",
  },
  {
    id: "m-b2",
    threadId: "th-rollback",
    authorId: "a-tianshu",
    replyToId: "a-ayan",
    time: "08:44",
    toolCalls: [
      {
        id: "tc-b2",
        kind: "search",
        title: "检索迁移文件",
        target: "migrations/2026*",
        status: "done",
        output: [
          "2026_02_11_add_thread_pin.sql   → pinned_at TIMESTAMP NULL",
          "2026_02_18_add_agent_team.sql   → team_id TEXT NOT NULL DEFAULT ''",
          "2026_02_20_add_burn_meter.sql   → burn_tokens INTEGER NOT NULL",
        ],
      },
    ],
    text: "第三条有问题。`burn_tokens INTEGER NOT NULL` 没有默认值，旧版本的插入语句不带这一列，回滚之后写入会直接失败。\n\n要么补一个 `DEFAULT 0`，要么把回滚窗口内的写入挡掉。我建议前者，改动一行，风险最低。",
  },

  // ── th-interview ─────────────────────────────────────────────────────────
  {
    id: "m-i1",
    threadId: "th-interview",
    authorId: "a-banxia",
    time: "周一 14:05",
    text: "第 7 轮访谈做完了，12 位重度用户。最集中的一条不是功能，是「我不知道我的智能体现在在干嘛」。\n\n有 9 位在没有任何提示的情况下，主动描述了同一个需求：希望有一个地方能一眼看到所有智能体的状态。这个信号很强。",
  },
  {
    id: "m-i2",
    threadId: "th-interview",
    authorId: "a-luchen",
    replyToId: "a-banxia",
    time: "周一 14:22",
    text: "行为数据能对上。用户平均每 3 分 12 秒就会切一次线程，其中 61% 的切换在 5 秒内切回来——典型的「只是去看一眼状态」。\n\n这不是在使用产品，是在轮询产品。",
  },

  // ── th-payment ───────────────────────────────────────────────────────────
  {
    id: "m-p1",
    threadId: "th-payment",
    authorId: "user",
    time: "11:02",
    text: "支付回调今天必须做完幂等，昨天有一笔重复入账。",
  },
  {
    id: "m-p2",
    threadId: "th-payment",
    authorId: "a-mujin",
    time: "11:03",
    toolCalls: [
      {
        id: "tc-p2",
        kind: "test",
        title: "运行测试",
        target: "npm test -- payment/callback",
        status: "done",
        output: [
          "✓ 正常回调入账 (24ms)",
          "✓ 签名错误拒绝 (8ms)",
          "✗ 同一 trade_no 重复回调 (12ms)",
          "  expected 1 ledger entry, received 2",
          "2 passed, 1 failed",
        ],
      },
    ],
    text: "测试已经能稳定复现。我打算用 `trade_no` 做唯一索引，插入冲突就当成已处理直接返回成功，不走业务逻辑。\n\n@霜研 这样对账那边看到的是「一次成功」还是「一次成功一次忽略」？合规上有没有要求把忽略也记下来？",
  },
  {
    id: "m-p3",
    threadId: "th-payment",
    authorId: "a-shuangyan",
    replyToId: "a-mujin",
    time: "11:14",
    text: "必须记。支付机构的对账要求是「所有回调都要有落地记录」，忽略也是一种处理结果。\n\n建议拆两张表：`payment_callbacks` 记原始回调，来一条记一条；`ledger` 只在首次成功时写。这样幂等和审计各自干净。",
  },

  // ── th-landing ───────────────────────────────────────────────────────────
  {
    id: "m-l1",
    threadId: "th-landing",
    authorId: "a-yeqiao",
    time: "15:20",
    text: "首屏三版文案都出来了。A 版讲功能，B 版讲结果，C 版直接放一句用户原话。\n\n我个人偏 C，但这类主观判断不该我拍板。@小满 你手上有投放数据，哪一版更像能跑得动的？",
  },
  {
    id: "m-l2",
    threadId: "th-landing",
    authorId: "a-xiaoman",
    replyToId: "a-yeqiao",
    time: "15:33",
    text: "同类账户里，讲结果的落地页平均 CTR 高 40% 左右，但停留时长短，退款率也高一点——预期被拉太高了。\n\n我建议 B 和 C 各跑一周，预算各 3,000。A 版直接砍掉，讲功能的在这个品类里从来没赢过。",
  },

  // ── th-eval ──────────────────────────────────────────────────────────────
  {
    id: "m-e1",
    threadId: "th-eval",
    authorId: "a-jingzhe",
    time: "07:40",
    toolCalls: [
      {
        id: "tc-e1",
        kind: "bash",
        title: "执行命令",
        target: "python -m bench.run --suite long-horizon --round 3",
        status: "running",
        output: [
          "[  1/120] repo-migration-small      pass  312s",
          "[  2/120] repo-migration-large      pass  1841s",
          "…",
          "[ 62/120] flaky-test-triage         fail  620s (timeout)",
          "running…",
        ],
      },
    ],
    text: "第三轮跑到 62/120。目前通过率 84%，比第二轮高 6 个点，但超时类失败反而变多了。\n\n@寒露 这个组合看着有点怪：更强的模型不该更容易超时。你看看是不是我们的超时阈值本身有问题。",
  },
  {
    id: "m-e2",
    threadId: "th-eval",
    authorId: "a-hanlu",
    replyToId: "a-jingzhe",
    time: "08:05",
    text: "不是阈值的问题，是模型行为变了。第三轮里失败样本的平均工具调用次数是 41 次，第二轮只有 17 次——它在更努力地尝试，然后撞上墙。\n\n换句话说这不是退步，是我们的超时把「坚持更久」惩罚掉了。指标设计有问题，不是模型有问题。",
  },
  {
    id: "m-e3",
    threadId: "th-eval",
    authorId: "a-guyu",
    replyToId: "a-hanlu",
    time: "08:19",
    text: "补一个数据支撑：把超时样本单独拎出来看，其中 71% 在被砍掉的时候进度条已经过半了。按「部分完成」重新计分的话，第三轮总分会再高 4 个点。\n\n建议加一个分档计分，不要只有过/不过。",
  },

  // ── th-survey ────────────────────────────────────────────────────────────
  {
    id: "m-s1",
    threadId: "th-survey",
    authorId: "a-shuangjiang",
    time: "周二 10:10",
    text: "本周 11 篇里有 3 篇值得细读，都围绕同一个问题：自改进的智能体如何避免在长周期里漂移。\n\n共同做法是引入一个不参与改进的「参照评测集」。这跟我们现在的做法正好相反，我们的评测集是跟着一起演化的。",
  },
  {
    id: "m-s2",
    threadId: "th-survey",
    authorId: "a-lichun",
    replyToId: "a-shuangjiang",
    time: "周二 10:38",
    text: "我想复现其中一篇的冻结集实验，但原始权重作者没放出来，只给了训练脚本。用近似模型复现的话结论可能不成立。\n\n这条先标成阻塞，等我们决定要不要自己训一个小规模的对照。",
  },

  // ── th-typescale ─────────────────────────────────────────────────────────
  {
    id: "m-t1",
    threadId: "th-typescale",
    authorId: "a-qingci",
    time: "20:05",
    text: "中文字号级联我倾向于放弃 1.25 的模数。汉字在小字号下的可读性掉得比拉丁字母快得多，14px 到 17.5px 这一跳在正文区间里太粗暴了。\n\n提议改成分段：正文区间用 1.125，标题区间用 1.333。@墨迟 你把两套都排出来看看实际差别。",
  },
  {
    id: "m-t2",
    threadId: "th-typescale",
    authorId: "a-mochi",
    replyToId: "a-qingci",
    time: "20:21",
    toolCalls: [
      {
        id: "tc-t2",
        kind: "edit",
        title: "生成对照表",
        target: "tokens/type-scale.json",
        status: "done",
        output: [
          "单一模数 1.25 → 12 / 15 / 18.75 / 23.4 / 29.3",
          "分段 1.125 + 1.333 → 12 / 13.5 / 15.2 / 20.2 / 27",
          "正文区间步长差: 3.0px → 1.7px",
        ],
      },
    ],
    text: "排出来了，你是对的。单一模数在正文区间一步 3px，屏幕上看就是「小字」和「大字」两档，中间没有过渡。分段之后 13.5 和 15.2 之间是有呼吸的。\n\n代价是级联表变复杂了，需要写清楚哪一段用哪个模数，否则后面的人会随手加一档破坏它。",
  },

  // ── th-contrast ──────────────────────────────────────────────────────────
  {
    id: "m-c1",
    threadId: "th-contrast",
    authorId: "a-baihe",
    time: "19:12",
    text: "浅色主题审计完成，34 处组合里有 6 处不达标。最严重的是次级说明文字，对比度 3.1:1，正文要求 4.5:1。\n\n这不是「差一点」，这是在明亮环境下会看不见。@青瓷 我们是调灰度还是调字号？",
  },
  {
    id: "m-c2",
    threadId: "th-contrast",
    authorId: "a-qingci",
    replyToId: "a-baihe",
    time: "19:30",
    text: "调灰度。字号是版式的一部分，动它会牵连整个级联；灰度只是一个色值。\n\n把次级灰从 #9A948B 压到 #8E877D，对比度到 4.6:1，视觉上几乎看不出变化。这是这次唯一不需要讨论的改动。",
  },
];
