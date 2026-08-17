# dsh-risk-guard

零打扰 Agent 审计 + 保险丝拦截插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。

[![npm](https://img.shields.io/npm/v/dsh-risk-guard)](https://www.npmjs.com/package/dsh-risk-guard)
[![License](https://img.shields.io/npm/l/dsh-risk-guard)](LICENSE)
[![Tested against dsh 0.1.0-rc.6](https://img.shields.io/badge/dsh-0.1.0--rc.6-202724)](https://github.com/deepseek-ai/deepseek-harness)

> **基准版本：dsh `0.1.0-rc.6`（npm `next` tag）。** dsh 处于开发者预览阶段，
> 会有破坏性变更；请保持 host 与 profile 的 `@deepseek-ai/*` 版本一致
> （见[故障排查](#故障排查)）。

## 它做什么

`dsh-risk-guard` 是 agent 的**行车记录仪 + 保险丝**。它不增加任何审批弹窗、
不改变权限预设、不碰沙箱，只做四件事：

1. **记录每次工具调用**（工具名、脱敏参数、成功/失败、风险标签、可解释风险分），
   写入本地 JSONL 文件；
2. **纯规则风险评分**——不调 LLM、零额外 API 成本。覆盖危险删除、凭据读取、
   网络外发、工作区外写入、依赖安装、重型构建；同标签高频与连续高风险调用
   会触发累积加分；
3. **只拦不可逆灾难**：受保护路径删除、磁盘擦除/格式化、force push 到受保护
   分支、网络命令引用凭据文件。被拦的调用会带明确原因失败，可一键关闭；
4. **`/risk-guard` 输出操作账单**：agent 做了什么、何时、多危险、为什么——
   支持当前会话、最近一轮、全部历史。

数据只存在本机 `<DSH_HOME>/risk-guard/` 下，不回传任何东西。

## 和 dsh-auto-mode 的区别

| | dsh-auto-mode | dsh-risk-guard |
| --- | --- | --- |
| 时机 | 执行前权限分类 | 静默审计 + 执行前保险丝 |
| 权限策略 | 新增 **Auto** 预设 | **不改变**审批/沙箱 |
| 弹窗 | 分类器 + 一次性审批 | 默认零弹窗 |
| 输出 | 审批决策 | `/risk-guard` 操作账单 + 风险分 |
| 智能 | LLM 分类器 | 确定性规则，零 LLM |
| 焦点 | 减少打断 | 可追溯审计 + 不可逆操作保护 |

两者互补：auto-mode 决定调用**之前**，本插件记住调用**之后**，并只拦
少数"绝不应该发生"的操作。

## 安装

需要先装好 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

```sh
dsh plugin --profile web add dsh-risk-guard
```

或手动在 profile 的 `cordis.patch.yml` 中插入插件
（参考 [cordis.patch.yml](./cordis.patch.yml)）。

## 使用

```text
/risk-guard              当前会话操作账单
/risk-guard --turn       只看最近一轮
/risk-guard --all        全部会话的汇总 + 账单
/risk-guard --json       机器可读输出
```

账单包含时间范围、调用数、轮次数、高风险数、保险丝拦截数、最高/总风险分、
标签分布、高风险操作表、以及每次保险丝拦截记录。

## 配置

在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
      config:
        fuseEnabled: true
        maxFileSizeMb: 50
        workspaceRoot: 'C:/projects/my-app'
        homeDir: 'C:/Users/me'
        dshHome: 'C:/Users/me/.dsh'
        protectedBranches: ['main', 'master']
        protectedRemotes: []
        credentialFileNames: ['.env', 'credentials', 'id_rsa']
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `fuseEnabled` | `true` | 保险丝总开关 |
| `maxFileSizeMb` | `50` | 月度 JSONL 超过该大小自动 gzip 归档 |
| `workspaceRoot` | 未设置 | 用于识别"工作区外写入" |
| `homeDir` | 系统 home | 路径规则与 `~` 展开使用的 home |
| `dshHome` | `~/.dsh` 或 `$DSH_HOME` | 审计数据存放于 `<dshHome>/risk-guard` |
| `protectedBranches` | `['main','master']` | 对这些分支 force push 会被拦 |
| `protectedRemotes` | `[]` | 对这些远端 force push 会被拦 |
| `credentialFileNames` | 常见凭据清单 | `.env`、`credentials`、`id_rsa` 等 |

## 保险丝规则（v1）

- `rm -rf` / `del` / `Remove-Item` 删除文件系统根、home 本身、`$HOME/*`、
  DSH_HOME 或凭据文件；
- 磁盘擦除/格式化（`dd of=/dev/sdX`、`mkfs*`、`wipefs`、`diskpart`、
  `shred /dev/…`、`format C:`）；
- `git push --force`/`-f` 到 `main`/`master`（或配置的受保护远端）；
  feature 分支**不拦**；
- 网络命令（`curl`、`wget`、`nc`、`scp`、`ssh` 等）引用凭据文件。

其余操作一律不打扰。`fuseEnabled: false` 可完全关闭保险丝，审计照常工作。

## 隐私与存储

- 记录以串行写入队列追加到 `<DSH_HOME>/risk-guard/<yyyy-mm>.jsonl`，
  超限自动 gzip 归档；
- 敏感形状值（GitHub token、`sk-` 密钥、私钥块、`Bearer`、`.env` 行、
  密码赋值）存储前脱敏，仅保留脱敏值的摘要用于关联；
- 插件不发任何网络请求、无遥测。

## 兼容性

| Profile | 状态 |
| --- | --- |
| `web` | Loader 组合测试 + `pnpm verify` 验证 |
| `headless` | 可用；无 commands 服务也可加载（命令为条件注册） |
| dsh `0.1.0-rc.6` | 已验证 |

## 故障排查

- **装完插件所有工具调用崩溃**——host 内置的 `@deepseek-ai/*` 与 profile 安装
  的版本不一致（`TOOL_RUNTIME_SCHEDULER` 是模块内符号）。请对齐版本并执行
  `pnpm dedupe`。
- **账单为空**——先开新一轮并跑几次工具调用；记录是异步写入的。
- **完全不想拦截**——设 `fuseEnabled: false`。

## 开发

```sh
pnpm install
pnpm verify   # typecheck + build + tests + 包契约校验
```

测试包含官方要求的真实 Cordis Loader 组合测试、规则/脱敏/评分/记录器/账单
单元测试，以及归档轮转覆盖。

## Roadmap（v2 候选）

- 可选 LLM 分类器（需额外费用，默认关闭）；
- token/费用预算计量；
- 历史回放 Web 面板；
- 按 agent 作用域的自定义规则。

## License

MIT
