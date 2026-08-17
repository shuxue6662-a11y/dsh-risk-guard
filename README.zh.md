# dsh-risk-guard

零打扰 Agent 审计 + 保险丝拦截插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。

[![npm](https://img.shields.io/npm/v/dsh-risk-guard)](https://www.npmjs.com/package/dsh-risk-guard)
[![License](https://img.shields.io/npm/l/dsh-risk-guard)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-202724)](https://github.com/deepseek-ai/deepseek-harness)

## 功能

- **静默审计**：记录每次工具调用（工具名、脱敏参数、成功/失败、风险标签、
  可解释风险分），写入本地 JSONL。不弹窗、不改权限、不碰沙箱。
- **纯规则风险评分**：零 LLM 调用、零额外成本。覆盖危险删除、凭据读取、
  网络外发、工作区外写入、依赖安装与重型构建；同标签高频和连续高风险调用
  会累积加分。
- **保险丝拦截**：只拦不可逆灾难——受保护路径删除、磁盘擦除/格式化、
  force push 到受保护分支、网络命令引用凭据文件。
- **操作账单**：`/risk-guard` 回答"我的 agent 到底干了什么"，包含分数、
  标签、原因与脱敏详情，支持当前会话、最近一轮、全部历史。

所有数据只存在本机 `<DSH_HOME>/risk-guard/` 下。无网络请求、无遥测。

## 安装

需要先装好 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

### 方式一：dsh 插件管理器（推荐）

```sh
dsh plugin --profile web add dsh-risk-guard
```

重启 Web UI，在任何会话中即可使用 `/risk-guard`。

### 方式二：npm

```sh
npm install dsh-risk-guard
```

或使用 pnpm：

```sh
pnpm add dsh-risk-guard
```

然后在 profile 的 `cordis.patch.yml` 中注册插件：

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
```

### 方式三：源码安装

```sh
git clone https://github.com/shuxue6662-a11y/dsh-risk-guard.git
cd dsh-risk-guard
pnpm install
pnpm build
dsh plugin --profile web add .
```

## 使用

```text
/risk-guard              当前会话操作账单
/risk-guard --turn       只看最近一轮
/risk-guard --all        全部会话的汇总 + 账单
/risk-guard --json       机器可读输出
```

账单包含时间范围、调用/轮次数、高风险与保险丝拦截数、最高/总风险分、
标签分布、高风险操作表，以及每次保险丝拦截记录。

## 配置

所有选项均可选，默认值如下：

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `fuseEnabled` | `true` | 保险丝总开关 |
| `maxFileSizeMb` | `50` | 月度 JSONL 超过该大小自动 gzip 归档 |
| `workspaceRoot` | 未设置 | 用于识别"工作区外写入" |
| `homeDir` | 系统 home | 路径规则与 `~` 展开使用的 home |
| `dshHome` | `~/.dsh` 或 `$DSH_HOME` | 审计数据存放于 `<dshHome>/risk-guard` |
| `protectedBranches` | `['main', 'master']` | 对这些分支 force push 会被拦 |
| `protectedRemotes` | `[]` | 对这些远端 force push 会被拦 |
| `credentialFileNames` | 常见凭据清单 | `.env`、`credentials`、`id_rsa` 等 |

示例：

```yaml
- insert:
    - id: risk-guard
      name: 'dsh-risk-guard'
      config:
        fuseEnabled: true
        workspaceRoot: 'C:/projects/my-app'
        protectedBranches: ['main', 'master']
```

## 保险丝规则（v1）

- `rm -rf` / `del` / `Remove-Item` 删除文件系统根、home 本身、`$HOME/*`、
  DSH_HOME 或凭据文件；
- 磁盘擦除/格式化（`dd of=/dev/sdX`、`mkfs*`、`wipefs`、`diskpart`、
  `shred /dev/…`、`format C:`）；
- `git push --force` / `-f` 到 `main`/`master` 或配置的受保护远端
  （feature 分支**不拦**）；
- 网络命令（`curl`、`wget`、`nc`、`scp`、`ssh` 等）引用凭据文件。

其余操作一律不打扰。设 `fuseEnabled: false` 可关闭保险丝，审计照常工作。

## 隐私与存储

- 记录通过串行写入队列追加到 `<DSH_HOME>/risk-guard/<yyyy-mm>.jsonl`，
  超限自动 gzip 归档；
- 敏感形状值（GitHub token、`sk-` 密钥、私钥块、`Bearer`、`.env` 行、
  密码赋值）存储前脱敏，仅保留脱敏值的摘要；
- 插件不发任何网络请求、无遥测。

## 兼容性

| 环境 | 状态 |
| --- | --- |
| dsh `0.1.0-rc.6`（npm `next`） | 已验证 |
| `web` profile | 已验证 |
| `headless` profile | 可用（命令为条件注册） |

## 故障排查

- **装完插件所有工具调用崩溃**——host 与 profile 的 `@deepseek-ai/*` 版本
  不一致。请重新安装插件并执行 `pnpm dedupe`。
- **账单为空**——先开新一轮并跑几次工具调用；记录是异步写入的。
- **完全不想拦截**——设 `fuseEnabled: false`。

## License

MIT
