# open-design 的 Codex Runtime 用法调查与对比

> 调查对象：`github.com/nexu-io/open-design`（一个已成熟的多 Agent 设计工具，Codex 是其支持的 runtime 之一）
> 对比对象：`docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md`（本项目的 Codex-native Runtime 契约草案）
> 目的：吸收 open-design 把 Codex 当作 Agent runtime 的**实战经验**，但保留判断——两个项目对 Codex 的定位不同，不照搬。
> 方法：直接读了 open-design 的源码和测试（`apps/daemon/src/runtimes/defs/codex.ts`、`json-event-stream.ts`、`codex-rollout-usage.ts`、`chat-run-lifecycle.ts`、`codex-config-normalize.ts`、`codex-cli.ts`、`env.ts`，以及 `tests/codex-session-resume.test.ts`、`tests/runtimes/codex-resume-args.test.ts`）。所有结论都有代码出处，不是文档转述。

## 0. 一句话结论

open-design 已经在生产里踩平了我们契约草案里"标为待验证"的绝大多数坑，而且踩法和我们的假设**有出入**。最值得吸收的三点：

1. **resume 不是"多传个 session id"那么简单**——`codex exec resume` 会拒绝 `--sandbox` / `-C` / `--add-dir`，sandbox 必须改用 `-c sandbox_mode=...` 传，且要和 create turn **逐字节一致**以命中 prefix cache。我们 review2 的 B4 担忧被证实，且比我们想的更细。
2. **session id 是 Codex 自己铸造、我们从流里捕获的（capture-style），不是我们指定的**——这一条直接改写我们 `RunExecutionPlan` 里 `codexThreadId` 的语义。
3. **Codex 的流式 usage 是累计值，拿不到单次调用的 cache 命中率**——要精确计费必须去读 `$CODEX_HOME/sessions/**/rollout-*.jsonl`。这是我们契约完全没意识到的一个数据缺口。

但 open-design 有一点**我们不能吸收**：它直接用用户真实的 `~/.codex`，不做独立 `CODEX_HOME` 托管。这与我们"独立 CODEX_HOME、Runtime 托管配置真相源"的核心定位冲突。详见 §4。

---

## 1. open-design 是怎么用 Codex 的（事实层）

### 1.1 架构定位：Codex 只是众多 runtime 之一
open-design 的 `apps/daemon/src/runtimes/defs/` 下有 20+ 个 agent def（codex、claude、gemini、cursor-agent、opencode、kimi……）。每个 runtime 是一个**声明式 def 对象**（`RuntimeAgentDef`），共用同一套 spawn / 流解析 / 生命周期基础设施。Codex 的 def 只有 207 行，绝大部分是 `buildArgs`。

对比我们：我们是**Codex-native**，Codex 是唯一内核。这意味着 open-design 的"多 runtime 抽象层"对我们是过度设计，但它的**单 runtime 契约细节**对我们几乎 100% 适用。

### 1.2 调用形态：`codex exec --json`，prompt 走 stdin
```
codex exec --json --skip-git-repo-check --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -C <cwd> --add-dir <dir> --model <model> -c model_reasoning_effort="high"
```
关键实测点（`defs/codex.ts:99-207`）：
- **prompt 走 stdin**（`promptViaStdin: true`），且**不能加 `-` 哨兵**——新版 Codex 见到裸 `-` 会报 `error: unexpected argument '-' found` 并以 code 2 退出（注释引用 issue #237）。我们契约说"prompt 走 stdin"是对的，但没提这个 `-` 陷阱。
- `--skip-git-repo-check`：非 git 目录下也能跑。我们契约完全没提这个 flag，而 managed workspace（`workspaces/run-<id>/`）默认不是 git 仓库，**不加这个 flag 第一版就会炸**。
- reasoning effort 通过 `-c model_reasoning_effort="..."` 传，不是独立 flag。与我们基础方案第 10 章一致。

### 1.3 sandbox 的平台差异（我们完全没覆盖）
`codexNeedsDangerFullAccessSandbox()`（`defs/codex.ts:47-59`）：
- **Windows 上 `workspace-write` 沙箱会阻断所有 shell 调用**（"powershell.exe ... rejected: blocked by policy"，issue #1721），因为 Codex 在 Windows 上没有 OS 级沙箱，退化成粗粒度策略直接拒绝 shell。所以 Windows 必须用 `danger-full-access`。
- **WSL 报告自己是 `linux` 但仍走 Windows 的只读沙箱路径**（issue #2834），也要特判。
- macOS（Seatbelt）和 Linux（Landlock+seccomp）才能正常用 `workspace-write`。

我们契约的 sandbox 只是一个三值枚举 `read-only | workspace-write | danger-full-access`，**默认把 `workspace-write` 当成跨平台可用**。这在 Windows/WSL 上是错的。review2 的 B6（sandbox 真实边界未验证）在这里得到具体佐证。

### 1.4 session resume：capture-style，且 resume 与 create 参数形态不同
这是 open-design 最精华、也最反直觉的部分（`defs/codex.ts:120-196` + 两个测试文件）：

**(a) id 是 Codex 铸造的，我们只能捕获**
- create turn 用**纯 `exec`，不传任何 id**。
- Codex 在流里吐 `{"type":"thread.started","thread_id":"..."}`，daemon 从这里**捕获** thread id 并持久化（`json-event-stream.ts:686-703`）。
- 下一轮用 `codex exec resume <thread_id>`，thread id 是**结尾的位置参数**。
- def 上用两个标志声明这个模型：`resumesSessionViaCli: true` + `capturesSessionIdFromStream: true`。

**(b) resume turn 拒绝一批 create-only 的 flag**（`codex-resume-args.test.ts` 是可执行规格）：
- `codex exec resume` **拒绝 `--sandbox`**，必须改用 `-c sandbox_mode="workspace-write"` 传。
- `codex exec resume` **拒绝 `-C` 和 `--add-dir`**（`error: unexpected argument '-C' found`，code 2）。daemon 的做法是：resume 时不传这俩，靠 `spawn` 的 `cwd` 选项把子进程起在正确目录；额外可写目录在 create 时已授权、由 resume 的 session 继承。
- 更微妙：resume 的 sandbox 配置必须和 create turn **逐字节一致**（byte-match），因为 Codex 的 per-turn `turn_context` 块要 byte-match 才能复用 upstream prefix cache——这是 resume 的**全部意义**。`defs/codex.ts:131-153` 为此精心构造了两种 flag 形态。

**(c) resume 失败的三条降级路径**（`codex-session-resume.test.ts`，全是真实测试）：
- **rollout 文件没了**（`no rollout found for thread id`）：daemon 清掉失效 handle，**在同一个 turn 内透明重跑成 fresh `exec`**（带完整 transcript reseed），用户无感、不报错、不产生额外 turn。发一个 `agent_resume_auto_reseed` 诊断事件。
- **turn 1 没捕获到 thread id**：turn 2 老实用 fresh `exec`。
- **中间有别的 agent（claude）在同一会话跑过一轮**：Codex 的 session 落后了，daemon **不 resume**（否则会静默丢掉中间那轮），而是 fresh `exec` + 全量 transcript reseed。

我们 review2 的 B4 说"resume 失败要定义错误码和终态"——open-design 的答案是：**大多数 resume 失败根本不该是错误，而是透明降级为 reseed**。这比我们设想的更成熟。

### 1.5 usage / 计费：流式数据不够，要读 rollout 文件
`codex-rollout-usage.ts` 揭示一个我们完全没意识到的问题：
- Codex 在 `exec --json` 流上给的 `turn.completed.usage` 是**整个 session 的累计值**，拿不到"这一轮开头那次模型调用的 cache 命中率"——而这恰恰是 session-reuse 省钱的关键指标。
- Codex 把单次调用 usage 记在 rollout JSONL 里：`$CODEX_HOME/sessions/<年>/<月>/<日>/rollout-<时间戳>-<thread_id>.jsonl`，每个 `token_count` event 带 `info.last_token_usage`。
- open-design 的做法：run 结束后，用捕获的 thread id 去 sessions 目录里**倒序找最近 8 个日期目录**定位 rollout 文件，解析出最后一个 turn 的首次调用 usage。全程 best-effort，找不到就放弃、不报错。

我们契约第 9.2 节的 `usage` payload 有 `cachedInputTokens`，但**默认以为流里就能拿到准确值**。事实是：流里只有累计值。要做准确计费，必须吸收这套 rollout 读取逻辑。

### 1.6 最终状态判定：多信号裁决，不是只看 exit code
`chat-run-lifecycle.ts:44-72` 的 `classifyChatRunCloseStatus` 综合了：`cancelRequested`、`code`、`signal`、`turnCompletedCleanly`、`artifactProducedThisRun`、以及 ACP 特殊退出（code 130 / SIGTERM）。特别是：
- **产出了 artifact 但 exit 非 0，仍判 succeeded**（agent 干完活但进程收尾异常）。
- `turn.failed` 事件即使 exit 0 也会 emit error（`json-event-stream.ts:675-684`）。

这正面印证 review2 的 B7（exit 0 + turn.failed 的判定空隙）——open-design 用一个集中的多信号裁决函数解决了。

### 1.7 config.toml 归一化：启动前先"消毒"
`codex-config-normalize.ts`：Codex app 会往 `config.toml` 写入 Codex CLI **拒绝**的值（如 `service_tier = "priority"`、嵌套 `[features.*]` 表），导致 CLI 在读 prompt 之前就崩。open-design 在每次启动前用原子写入（temp + rename）把这些非法行**删掉**，让 CLI 回退到默认值。而且它明确采用"白名单之外全删"的策略，而不是维护一张"已知坏值"映射表（避免 whack-a-mole）。

我们契约第 7.2 节讲了 TOML 原子写入，但没意识到"**Codex 自己/Codex app 会写出让 CLI 崩溃的配置**"这个现实，需要一个防御性的归一化层。

### 1.8 MCP：shell 调 `codex mcp add`，不自己写 TOML
`codex-cli.ts`：open-design 装 MCP 是 `codex mcp add <name> --env K=V -- <command> <args>`，卸载是 `codex mcp remove`，探测是 `codex mcp get`（exit 0 = 已装）。注释明说：**故意 shell 出去而不自己改 config.toml，以继承 Codex 自己的 merge/dedupe/validation 规则**。带 30s 超时。

这和我们基础方案第 7.6 节的 MCP pass-through 思路一致，可以直接抄它的实现细节（尤其 `--env` 和 `--` 分隔符的用法、以及"用 `mcp get` 的 exit code 判断是否已安装"）。

### 1.9 其它可直接抄的工程细节
- **prompt argv 预算保护**（`prompt-budget.ts`）：Windows CreateProcess ~32KB、Linux MAX_ARG_STRLEN 128KB、macOS ARG_MAX 256KB。stdin 形态基本免疫，但保留一个 100KB 的 POSIX 兜底，让超大 prompt 快速失败并给可操作提示，而不是撞 E2BIG。
- **inactivity watchdog**（`chat-run-lifecycle.ts:1-42`）：不是只有总超时，还有"多久没输出就算挂了"的 inactivity timeout（默认 10min），且 artifact 产出后切换到更短的 quiet-period（60s）。比我们契约的 `spawnTimeoutMs` + `runTimeoutMs` 两个 timeout 更贴合真实"卡住"场景。
- **可恢复的 Reconnecting 事件**（`json-event-stream.ts:127-135`）：Codex 吐 `Reconnecting... timeout waiting for child process` 是**可恢复**的，要当 status warning 而不是 fatal error。
- **stdin 在收到干净终态后主动 `end()`**（`chat-run-lifecycle.ts:85-109`）：让 Codex 知道没有更多输入。
- **CODEX_HOME 解析要展开 `~`**（`codex-config-normalize.ts:42-62`）：daemon 侧和子进程侧必须用同一套 `~` 展开逻辑，否则 normalizer patch 错文件。

---

## 2. 逐点对比表

| 维度 | 本项目契约草案 | open-design 实测做法 | 差距 / 该不该吸收 |
|---|---|---|---|
| Codex 定位 | 唯一内核（Codex-native） | 众多 runtime 之一 | 定位不同，多 runtime 抽象**不吸收** |
| 调用命令 | `codex exec --json` + flags | 同，且加 `--skip-git-repo-check`、禁 `-` 哨兵 | **吸收**：补 `--skip-git-repo-check`、stdin 不带 `-` |
| prompt 传递 | stdin | stdin（`promptViaStdin`） | 一致 |
| sandbox 跨平台 | 三值枚举，默认 workspace-write 通用 | Windows/WSL 必须 danger-full-access | **吸收**：加平台特判，否则 Win/WSL 直接不可用 |
| 多轮 resume 语义 | `codex exec resume <id>`（review2 说"待验证"） | capture-style：id 由 Codex 铸造、从流捕获 | **吸收并改写** `codexThreadId` 语义 |
| resume 参数形态 | 未区分 create/resume | resume 拒绝 `--sandbox`/`-C`/`--add-dir`，改 `-c` + spawn cwd | **吸收**：这是硬约束，不吸收 R2 直接炸 |
| prefix cache | 未提及 | resume 的 sandbox 配置须与 create byte-match | **吸收**：否则 resume 白做（缓存不命中） |
| resume 失败处理 | review2 要求"定义错误码/终态" | 多数失败透明降级为 fresh exec + reseed | **吸收**：比报错更好的产品行为 |
| 跨 agent 会话一致性 | 无（我们单 runtime，暂不涉及） | 中途别的 agent 跑过就不 resume | 部分吸收：即使单 runtime，schedule/手动混用也可能 stale |
| usage / 计费 | 假设流里有准确 cache 数据 | 流是累计值，须读 rollout JSONL 补首调用 usage | **吸收**：否则计费/缓存指标是错的 |
| 最终状态判定 | 8.8 节多信号（已补） | 集中式多信号裁决函数 | 一致，可抄它的裁决表 |
| config.toml 健壮性 | 只讲原子写入 | 启动前归一化，删 CLI 拒绝的非法值 | **吸收**：加防御性 normalize 层 |
| MCP 管理 | pass-through（基础方案） | shell `codex mcp add/remove/get` + 30s 超时 | **吸收**实现细节 |
| CODEX_HOME | 独立托管，Runtime 是配置真相源 | 直接用用户 `~/.codex`，不托管 | **保留不吸收**，见 §4 |
| 超时模型 | spawnTimeout + runTimeout | + inactivity watchdog + artifact quiet-period | **吸收** inactivity 维度 |
| 事件解析健壮性 | 三层（raw/产品/unknown） | 逐行 JSON、坏行降级 raw、Reconnecting 可恢复 | 一致，可抄可恢复错误清单 |

---

## 3. 强烈建议吸收的点（按优先级）

### P1（不吸收则里程碑会炸）
1. **`--skip-git-repo-check`**：managed workspace 非 git 目录，必须加。（`defs/codex.ts:155-156`）
2. **resume 的 create-only flag 约束**：`codex exec resume` 拒绝 `--sandbox`/`-C`/`--add-dir`；sandbox 改 `-c sandbox_mode=...`，cwd 靠 spawn 的 cwd 选项。把这写进契约第 8 章 resume 小节，并把 `codex-resume-args.test.ts` 的断言变成我们的 R-1 spike 验收项。
3. **capture-style session id**：改写 `RunExecutionPlan.codexThreadId` 的语义为"从 `thread.started` 捕获后回填"，明确 create turn 不传 id。
4. **sandbox 平台特判**：Windows/WSL 强制 danger-full-access（或明确不支持 Windows）。

### P2（不吸收则功能不完整/计费错误）
5. **usage 从 rollout 文件补齐**：吸收 `codex-rollout-usage.ts` 的思路——流里 usage 是累计值，精确 cache 命中率要读 `$CODEX_HOME/sessions/**/rollout-*-<thread_id>.jsonl`。把 rollout 路径规则写进契约。
6. **config.toml 归一化层**：启动前删 CLI 拒绝的非法 config 值（`service_tier` 白名单外、嵌套 `[features.*]`），原子写入。
7. **resume 失败透明降级**：`no rollout found` 等失败 → 清 handle + 同 turn 内 fresh exec reseed，不报错。改写 review2 的 B4 结论。
8. **inactivity watchdog**：在 spawn/run timeout 之外加"无输出超时"。

### P3（工程质量，抄了省事）
9. `-` 哨兵陷阱、`Reconnecting...` 可恢复错误清单、stdin 干净终态后 `end()`、prompt argv 预算兜底、`~` 展开一致性、MCP `mcp get` exit code 判装。

---

## 4. 明确"保留、不吸收"的点

### 4.1 CODEX_HOME 托管（核心分歧）
open-design **直接用用户真实的 `~/.codex`**（`codex-rollout-usage.ts:167`、`codex-pets.ts:79`：`process.env.CODEX_HOME?.trim() || ~/.codex`），只在 sandbox 模式下才可能重定位。它把 Codex 当"用户已经装好、登录好的本地工具"，自己不托管配置真相源。

我们的定位相反：**独立 `CODEX_HOME`（`~/.your-agent/codex-home`），Runtime 是配置真相源，profile/skills/MCP 写操作都经过 Runtime**。这是我们契约第 7 章的核心，也是"自有 Agent 产品"与"设计工具顺便支持 Codex"的根本区别。

**结论：不吸收 open-design 的"用全局 ~/.codex"做法。** 但要吸收它的两个衍生教训：
- 无论托管与否，**`CODEX_HOME` 的 `~` 展开必须 daemon 侧和子进程侧一致**（否则 normalize / rollout 定位全错）。
- rollout 文件路径是 `$CODEX_HOME/sessions/<y>/<m>/<d>/rollout-*.jsonl`——我们托管独立 CODEX_HOME 反而**更容易**精确定位 rollout（不会和用户其它 Codex 使用混在一起），这是我们定位带来的优势，应写进契约。

### 4.2 多 runtime 抽象层
open-design 的 `RuntimeAgentDef` / `streamFormat` / `eventParser` 分发是为 20+ agent 设计的。我们是 Codex-native，**不需要这层抽象**。但它的 def 字段设计（`resumesSessionViaCli`、`capturesSessionIdFromStream`、`promptViaStdin`、`inactivityTimeoutMs`）可以作为我们 Codex 单 def 的**配置项清单**参考。

### 4.3 artifact / design-tool 专有逻辑
`json-event-stream.ts` 里大量 `<artifact>` 去重、`suppressDuplicateArtifactText` 逻辑是 open-design 作为**设计产物工具**的专有需求，与我们无关，不吸收。

### 4.4 token 级流式的取舍
open-design 对 Codex 也是**消息级**处理（`item.completed agent_message` 整块 emit，`json-event-stream.ts:783-800`），它自己有专门处理 token 级 delta 的分支是给 cursor-agent / gemini 用的，不是给 Codex 用的。这**印证了我们契约第 0 节的判断**：Codex 第一版就是消息级，不承诺 token 打字机。我们的保守假设是对的。

---

## 5. 对现有契约草案的具体修改建议

| 契约位置 | 建议动作 | 依据 |
|---|---|---|
| 第 0 节实测记录 | 增加 Windows/WSL sandbox、`--skip-git-repo-check`、resume flag 约束、rollout usage 四条待验证项 | §1.3-1.5 |
| §6.5 事件映射 | 补 `turn.failed`（exit 0 也判失败）、`Reconnecting...`（可恢复 warning）、`item.updated` todo_list | §1.6、1.9 |
| §8.1 Chat/thread | 改写：create 不传 id；从 `thread.started` 捕获 `codexThreadId`；明确 capture-style | §1.4a |
| §8.1 新增 resume 小节 | 写死 resume 的 flag 差异（禁 `--sandbox`/`-C`/`--add-dir`，改 `-c`，cwd 靠 spawn）+ byte-match prefix cache 要求 | §1.4b |
| §8.1 resume 失败 | 改写 review2-B4：多数失败透明 reseed，不报错；只有真正无法继续才 error | §1.4c |
| §8.6 超时 | 增加 inactivity watchdog 维度 | §1.9 |
| §8.8 状态判定 | 增加"产出 artifact 但非 0 退出仍 succeeded"类多信号，参考裁决函数 | §1.6 |
| §7.2 配置写入 | 增加"启动前 config.toml 归一化"防御层 | §1.7 |
| §9.2 usage payload | 注明流内 usage 为累计值；精确 cache 命中率需读 rollout JSONL；补 rollout 路径契约 | §1.5 |
| §8.4 并发 | 补：同一 `codexThreadId` 串行（resume 会写 session 状态）——呼应 review2-B3 | §1.4 + review2 |
| R-1 spike 清单 | 把 `codex-resume-args.test.ts` 的 7 条断言、rollout 路径、Windows sandbox 纳入验收 | 全文 |

---

## 6. 收尾判断

open-design 对我们最大的价值不是"架构"（我们定位不同，它的多 runtime 层不适用），而是**它已经把 Codex CLI 这个外部 ABI 的边角行为在生产里逐个撞过一遍，并留下了可执行的测试作为规格**。我们契约草案第 0 节自己说"必须先做验证 spike 才能定稿"——open-design 的这几个文件，等于**替我们把 spike 的答案写了一大半**。

最该立刻做的一件事：把 `codex-resume-args.test.ts` 和 `codex-session-resume.test.ts` 的断言逐条搬进我们的 R-1 spike 验收清单，用**我们自己托管的独立 CODEX_HOME** 复跑一遍确认行为一致（尤其 rollout 路径在独立 CODEX_HOME 下的定位）。确认后，review2 里 B3/B4/B7 三条就能从"待解决"直接落地成契约。

需要注意的保留项只有一个、但很关键：**不要被 open-design "直接用 ~/.codex" 带跑偏**——那是它作为设计工具的合理选择，不是我们作为自有 Agent 产品的选择。我们的独立 CODEX_HOME 托管是特性，不是负担，而且它让 rollout 定位、配置归一化、多 profile 隔离都比 open-design 更干净。

---

*调查人：Claude Code (claude-opus-4.8) ／ 2026-07-03 ／ 基于 open-design 源码实读*
