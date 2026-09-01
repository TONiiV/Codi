import type { DiffCard, ToolCall } from "./types";

export type ReplyTemplate = {
  text: string;
  toolCalls?: ToolCall[];
  diff?: DiffCard;
  /**
   * When present the agent hands off to a teammate. `{@}` is replaced at
   * runtime with a real `@名字`, and that teammate then answers.
   */
  handoff?: string;
};

const tool = (
  id: string,
  kind: ToolCall["kind"],
  title: string,
  target: string,
  output: string[],
): ToolCall => ({ id, kind, title, target, output, status: "done" });

/** Replies used when the human addresses an agent directly. */
export const REPLY_POOL: Record<string, ReplyTemplate[]> = {
  a_default: [
    {
      text: "收到。我先把范围圈出来，再动手，避免改到不相干的地方。",
      handoff: "{@} 这块和你手上的有重叠，先对一下边界？",
    },
    { text: "明白，我按这个方向做，做完把差异贴上来。" },
  ],

  "a-yanqing": [
    {
      text: "我先看一眼现状再回答，避免凭印象下结论。",
      toolCalls: [
        tool("t-y1", "read", "读取文件", "src/kernel/events.ts", [
          "export const EVENTS = [",
          "  'thread.created', 'thread.renamed', 'turn.started',",
          "  'turn.completed', 'checkpoint.written', …18 total",
          "] as const",
        ]),
      ],
      handoff: "{@} 实现层面你更熟，这个改法你觉得代价可控吗？",
    },
    {
      text: "结论是可以做，但要分两步：先让新旧读模型并存，观察两周，再摘掉旧的。一次切干净听起来干脆，出问题时却没有退路。\n\n我不建议为了少写一个开关而赌上回滚能力。",
    },
  ],

  "a-bailu": [
    {
      text: "改动集中在三个读取点，我先出一版最小差异，你看方向对不对。",
      diff: {
        file: "src/routes/thread.$id.tsx",
        added: 7,
        removed: 3,
        hunk: "@@ -58,10 +58,14 @@ export function ThreadRoute() {",
        lines: [
          { type: "ctx", text: "export function ThreadRoute() {" },
          { type: "ctx", text: "  const id = useParams().id" },
          { type: "del", text: "  useEffect(() => composerDraft.clear(), [id])" },
          { type: "add", text: "  const draft = useDraft(id)" },
          { type: "add", text: "" },
          { type: "add", text: "  // Restore the anchor the list handed us on unmount." },
          { type: "add", text: "  useLayoutEffect(() => restoreAnchor(id), [id])" },
          { type: "ctx", text: "  return <ThreadView draft={draft} />" },
        ],
      },
      handoff: "{@} 这个改法有没有踩到你在意的地方？",
    },
    {
      text: "做完了，本地跑过一轮。切走再切回草稿还在，滚动位置也对上了。\n\n有一个已知缺口：如果线程在切走期间被服务端删掉，回来时锚点会指向空列表。我加了兜底，回到顶部而不是崩。",
    },
  ],

  "a-luchen": [
    {
      text: "我拉一下数据再说，凭感觉判断这种事没意义。",
      toolCalls: [
        tool("t-l1", "search", "查询埋点", "event=draft.lost.offline · 30d", [
          "总触发 4,182 次 · 设备 1,106 台",
          "单设备单线程占比 78.2%",
          "多设备并发编辑占比 3.1%",
          "其余 18.7% 为同设备多线程",
        ]),
      ],
    },
    {
      text: "数据支持你的判断，但幅度没有想象中大。真正值得做的是前半段，后半段的收益在小数点后面。\n\n我建议先只做前半段，两周后拿真实数据再决定要不要继续。",
    },
  ],

  "a-ayan": [
    {
      text: "我把这件事写成发布说明的一条，顺便记进决策记录，免得三个月后没人记得为什么这么做。",
      handoff: "{@} 上线前你要不要先过一遍？",
    },
    { text: "文档更新完了，涉及三处：发布说明、迁移指引、以及常见问题里的回滚章节。" },
  ],

  "a-tianshu": [
    {
      text: "我只做静态评审，端到端那一层还是跑不了，凭据的事没解。\n\n静态看下来两个问题：错误路径没有测试覆盖；以及有一个 catch 把异常吞掉了只打了日志，线上会变成静默失败。",
    },
    {
      text: "可以合，但请先补一个用例：切走再切回，断言草稿内容一字不差。这次的回归就是因为没人测这条路径。",
    },
  ],

  "a-banxia": [
    {
      text: "从访谈看，用户对这个改动是无感的——他们描述问题时从来不提这一层。\n\n这不代表不该做，只代表做完不要指望满意度会动。真正被反复提到的还是「不知道智能体在干嘛」。",
    },
    { text: "我从上一轮的 12 份纪要里筛了相关片段，有 4 位提到过类似情况，措辞都很含糊，需要再追一轮才能定性。" },
  ],

  "a-mujin": [
    {
      text: "先复现，再修。",
      toolCalls: [
        tool("t-m1", "test", "运行测试", "npm test -- payment/callback", [
          "✓ 正常回调入账 (24ms)",
          "✗ 同一 trade_no 重复回调 (12ms)",
          "  expected 1 ledger entry, received 2",
        ]),
      ],
      handoff: "{@} 合规上有额外要求吗？",
    },
    { text: "唯一索引加上了，冲突路径直接返回成功。重复回调现在只会多一条回调记录，不会多一笔账。" },
  ],

  "a-shuangyan": [
    {
      text: "合规角度只有一条硬要求：所有回调都要有落地记录，包括被忽略的。忽略也是一种处理结果，对账时要能解释清楚每一条从哪来。",
    },
    { text: "条款我改了两处措辞，把「可能」换成了「将」，模糊表述在争议时会站在我们的对立面。" },
  ],

  "a-yeqiao": [
    {
      text: "文案我出三版：讲功能、讲结果、用用户原话。我个人偏第三种，但这类判断不该由写的人拍板。",
      handoff: "{@} 你手上有数据，哪一版更像能跑得动的？",
    },
    { text: "改完了。删掉了两个形容词和一整句自夸——那句话读者只会跳过。" },
  ],

  "a-xiaoman": [
    {
      text: "同类账户的历史数据里，讲结果的那一类 CTR 明显更高，但退款率也更高。建议两版并投一周再定，别现在拍。",
    },
    { text: "预算我按 3,000 一版排了，超过就停。这个品类的学习成本不值得为一次实验烧更多。" },
  ],

  "a-jingzhe": [
    {
      text: "我把这一批重新排进队列，跑完再给结论。",
      toolCalls: [
        tool("t-j1", "bash", "执行命令", "python -m bench.run --suite long-horizon", [
          "queued 120 tasks · concurrency 8",
          "estimated wall clock ≈ 3h40m",
        ]),
      ],
      handoff: "{@} 跑完你直接看方差，别等我汇总。",
    },
    { text: "跑完了。通过率比上一轮高，但失败样本的形态变了——不是不会做，是做到一半被超时砍掉。" },
  ],

  "a-hanlu": [
    {
      text: "这个差异不是模型变差了，是我们的指标在惩罚「坚持更久」。失败样本的平均工具调用次数翻了一倍多，它在更努力地尝试，然后撞上超时墙。\n\n要改的是口径，不是模型。",
    },
    { text: "我算了一下，把超时样本按进度重新计分，整体会再高 4 个点左右。这个差距足以改变结论。" },
  ],

  "a-guyu": [
    { text: "样本我清过一遍，去掉了 7 个重复任务和 2 个描述有歧义的。剩下的口径是一致的。" },
    { text: "补一个佐证：超时样本里有七成在被砍掉时进度已经过半。二值判定把这部分信息全丢了。" },
  ],

  "a-shuangjiang": [
    {
      text: "这一批里有三篇在做同一件事：用一个不参与改进的参照集来防漂移。我们现在的做法正相反，评测集是跟着一起演化的。\n\n这可能是我们看不到漂移的原因，而不是没有漂移。",
    },
    { text: "摘要写好了，按「改什么」分的类：改提示、改工具、改权重、改评测。这条轴比按方法分更不容易重复。" },
  ],

  "a-lichun": [
    {
      text: "我想复现，但原始权重作者没放出来。用近似模型跑出来的结论说服力有限，先标成阻塞。",
    },
    { text: "复现脚本我已经改到能跑，缺的只有权重。要么找作者要，要么我们自己训一个小规模对照。" },
  ],

  "a-qingci": [
    {
      text: "我的判断是不要动字号，动灰度。字号是版式的一部分，改它会牵连整条级联；灰度只是一个色值，改完谁也看不出来。",
      handoff: "{@} 你把两套都排出来，我们看实际差别再定。",
    },
    { text: "定了就写进文档，并且写清楚边界在哪。不写清楚的话，下一个人会随手加一档，然后级联就没了。" },
  ],

  "a-mochi": [
    {
      text: "排出来了，差别比预期明显。",
      toolCalls: [
        tool("t-mo1", "edit", "生成对照表", "tokens/type-scale.json", [
          "单一模数 1.25   → 12 / 15 / 18.75 / 23.4",
          "分段 1.125+1.333 → 12 / 13.5 / 15.2 / 20.2",
          "正文区间步长: 3.0px → 1.7px",
        ]),
      ],
    },
    { text: "代价是级联表复杂了一点，需要额外一段说明。我觉得这个代价值得。" },
  ],

  "a-liuying": [
    { text: "过场时长我建议统一到 180ms 以内，超过之后用户会开始感觉到「在等」。" },
    { text: "这个交互不需要动效。加了反而会让状态变化变慢，直接切更诚实。" },
  ],

  "a-baihe": [
    {
      text: "审计了一遍，有六处不达标，最严重的是次级说明文字，3.1:1。这不是差一点，是在明亮环境下会看不见。",
      handoff: "{@} 我们是调灰度还是调字号？",
    },
    { text: "改完复测通过，六处全部到 4.5:1 以上，最低的一处是 4.6:1。" },
  ],
};

/** Replies used when another agent @-mentions this one. */
export const MENTIONED_POOL: Record<string, ReplyTemplate[]> = {
  a_default: [
    { text: "看到了。这块归我，我接。给我一点时间把上下文补齐再回你。" },
    { text: "同意主体思路，有一个细节要收紧，我在下面说。" },
  ],

  "a-yanqing": [
    {
      text: "方向没问题，但有一处我要收紧：这个结构没有上限，长期运行会一直涨。加个淘汰策略，宁可复杂一点也不要留一个会慢慢变大的东西在系统里。",
    },
  ],
  "a-bailu": [
    { text: "实现上没问题，改动大概三个文件。麻烦的是取不到内部状态，需要让它在卸载前抛出来，外面存着。" },
  ],
  "a-luchen": [
    { text: "我这边有数据能回答这个问题，拉一下就知道，不用猜。结论倾向于「值得做，但只做一半」。" },
  ],
  "a-ayan": [{ text: "我来记。这条会同时进发布说明和决策记录，避免以后重新讨论一遍。" }],
  "a-tianshu": [
    { text: "红线三条：丢用户输入的路径必须有测试；淘汰不能吃掉非空内容；写回不要放在卸载的同步路径上。" },
  ],
  "a-banxia": [{ text: "从用户侧看，这个改动是无感的。做，但别指望它改善满意度。" }],
  "a-mujin": [{ text: "实现没问题，我加一张表就行。回调记原始，账目只在首次成功时写。" }],
  "a-shuangyan": [{ text: "合规上要求所有回调都留痕，忽略也算处理结果。分表是对的。" }],
  "a-yeqiao": [{ text: "那我按这个方向重写一版，砍掉自夸的部分。" }],
  "a-xiaoman": [{ text: "数据上讲结果的那一版更强，但要盯退款率。两版并投，一周见分晓。" }],
  "a-jingzhe": [{ text: "我重新排一遍队列，这次把超时样本单独标出来，方便后面重新计分。" }],
  "a-hanlu": [{ text: "我看了方差，问题在口径不在模型。指标在惩罚更努力的那一个。" }],
  "a-guyu": [{ text: "样本我再清一遍，把有歧义的剔掉，免得结论建在脏数据上。" }],
  "a-shuangjiang": [{ text: "文献里有先例，做法是引入一个不参与改进的参照集。我把相关三篇整理给你。" }],
  "a-lichun": [{ text: "我这边卡在权重上，复现做不了。要么找作者，要么自己训个小的。" }],
  "a-qingci": [{ text: "我倾向于改灰度不改字号。字号会牵连整条级联，灰度只是一个色值。" }],
  "a-mochi": [{ text: "我把两套都排出来，屏幕上一比就清楚了，不用争。" }],
  "a-liuying": [{ text: "动效上我建议什么都不加。状态变化直接切最诚实。" }],
  "a-baihe": [{ text: "我复测一遍，六处全部到 4.5:1 以上才算过。" }],
};

/** Questions an agent asks when handing off to a teammate it has not yet met. */
export const JOIN_NOTE = "加入了对话";
