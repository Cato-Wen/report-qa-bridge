# report-qa-bridge (rqb)

让同事直接在你用 Claude Code 生成的 HTML 报告里**选中文字，向 Claude 提问**。问题会转到你电脑上的 Claude Code，由一个**只读**进程回答。这个进程从生成报告的那个会话 fork 出来，所以带着完整的上下文。

- **多人使用**：每人一个个人口令（服务端只存哈希），日志里记录是谁问的；按人限流；同时最多处理 N 个问题。
- **一个服务管多份报告**：每份报告由作者决定 fork 哪个会话、暴露哪些 MCP 和 skill、哪些人可以问。
- **默认安全**：
  - 没有 Bash，不能写文件；
  - MongoDB、BigQuery 自动只读；
  - 其他 MCP 必须列出允许调用的工具；
  - 每次工具调用都要过 guard hook 检查。
- **零依赖**：Node 18+ 即可，报告用 `file://` 打开也能用。

```
同事浏览器 (报告.html + 问答面板) ──HTTP──▶ rqb serve (作者电脑, :8787)
                                              │  校验个人口令 → 检查报告的提问名单 → 按人限流 → 排队
                                              ▼
                     claude -p --resume <报告会话> --fork-session --restricted
                       --tools Read,Grep,Glob[,Skill]   --permission-mode dontAsk
                       --mcp-config <作者选的 MCP, 只读>  --plugin-dir <作者选的 skill>
                       PreToolUse guard（只读白名单）
```

## 安装

```bash
git clone https://github.com/Cato-Wen/report-qa-bridge.git
cd report-qa-bridge
npm link        # 可选：之后可以直接用 `rqb` 命令；不 link 就用 `node bin/rqb.mjs`
```

前提：本机已安装并登录 Claude Code（`claude --version` 能运行）。状态数据存放在 `~/.report-qa-bridge`（可以用 `RQB_HOME` 改位置），不会写进仓库。

## 快速开始

```bash
# 1. 给每个同事发一个个人口令（只显示一次；--out 表示写入文件，方便逐个转发）
rqb user add knight,robert,bonnie --out ~/rqb-tokens.txt

# 2.（可选）设置新报告默认暴露的 MCP 和 skill
rqb defaults set --mcp mongodb-qa,mongodb-uat,mongodb-prod,bigquery

# 3. 登记报告，同时把问答面板注入 HTML（没有指定 --mcp / --skills 时使用默认值）
#    默认 fork 你在这个仓库里最近的交互会话（--session current）
rqb report add docs/report.html --id my-report \
    --mcp mongodb-qa,mongodb-prod \
    --skills wonder-cookbook \
    --users knight,bonnie

# 4. 启动服务（默认监听内网 0.0.0.0:8787，启动时会打印内网地址）
rqb serve
```

然后把 HTML 文件发给同事。每人第一次打开时，点右下角"💬 问 Claude"，在 ⚙ 里填**服务地址**和**自己的口令**。填一次之后，这台电脑上所有用 rqb 生成的报告都通用。

## 作者能选什么

| 选项 | 说明 |
|---|---|
| `--session current\|none\|<id>` | 回答从哪个会话 fork 出来。`current` 表示 `--cwd` 下最近的交互会话；`none` 表示不带上下文 |
| `--cwd <dir>` | 回答进程可以读的仓库目录（默认取 HTML 所在的 git 根目录） |
| `--mcp a,b\|none` | 暴露的 MCP server（从 `~/.claude.json` 和 `.mcp.json` 中查找），不指定时使用 `rqb defaults` 的默认值。有两类会被强制只读：**MongoDB**（加 `--readOnly`，禁用 `export`，guard 拦截 `$out` / `$merge` / `$where`）；**BigQuery**（Google MCP Toolbox `--prebuilt bigquery`：只开放元数据工具和 `execute_sql`，guard 只放行单条 `SELECT` / `WITH` 查询；`forecast` / `analyze_contribution` / `ask_data_insights` 不开放） |
| `--mcp-tools name=t1,t2` | 只暴露某个 server 的部分工具。**没有内置只读模式的 server 必须指定**，否则拒绝登记 |
| `--skills a,b\|none` | 暴露的 skill：会复制进一个私有 plugin（符号链接会解析成实际文件），以 `rqb:<name>` 的名字出现，可以读取自己的 `references/`。没有 Bash，所以 skill 附带的脚本跑不了 |
| `--users a,b\|*` | 谁可以问（默认 `*`，表示所有用户） |
| `--prompt <text>` | 给回答模型的补充说明 |
| `--lang zh\|en` | 面板语言（默认取 `<html lang>`） |

修改设置用 `rqb report update <id> --mcp ... --skills ...`，会自动重新注入 HTML。查看设置用 `rqb report show <id>`。

## 命令一览

```
rqb serve [--local] [--port 8787] [--allow ip1,ip2] [--concurrency 2] [--per-user 20] [--model m]
rqb user add|rotate <a,b,...> [--out file]  |  rqb user remove <name>  |  rqb user list
rqb report add <html> --id <id> [选项]  |  update <id> [选项]  |  list  |  show <id>  |  remove <id>
rqb inject <html> --id <id>      # 只重新注入面板（比如 HTML 重新生成之后）
rqb defaults show | set [--mcp a,b|none] [--skills a,b|none]   # 新报告的默认值
rqb stats [--days 7]             # 按人 / 报告统计问题数和花费
rqb doctor                       # 检查 claude CLI、用户、报告、MCP、skill
```

## 安全模型

1. **个人口令**：服务端只存 SHA-256 哈希，比较时用常量时间比较。`rqb user rotate` 可以立即作废旧口令。可选 `--allow` 限制来源 IP。
2. **报告级权限**：
   - 只有在报告提问名单里的人才能问；
   - 话题归属于提问人，别人拿到 threadId 也接不上这个话题。
3. **`claude --restricted`**：
   - 不加载作者的设置、hooks 和 plugin；
   - 拒绝 bypass 模式；
   - 文件读取限制在 `--cwd` 内；
   - 只启用 Read / Grep / Glob / ToolSearch（加上作者选的 Skill）；
   - `--permission-mode dontAsk` 会拒绝所有不在白名单里的工具。
4. **guard hook**（`src/guard.mjs`）：每次工具调用都要过检查，出错时一律拦截：
   - MCP 只放行作者选的 server 和工具，MongoDB 只放行读操作；
   - skill 只放行作者选的；
   - 拦截读取 `.env`、密钥、`.claude`、`.git` 等路径。
5. **系统提示词**：同事的问题按不可信输入处理；不输出凭据和个人信息；用提问人使用的语言回答。
6. **MCP 凭据**：运行时从作者的 `~/.claude.json` 读取，写到系统临时目录（`rqb-runtime-*`），退出时删除；如果是被强杀的，下次启动时会清理。

BigQuery 的只读是靠 guard 检查 SQL 实现的（Toolbox 0.17 没有只读开关）。更稳妥的做法是给 `GOOGLE_APPLICATION_CREDENTIALS` 用一个只有 BigQuery Data Viewer + Job User 权限的服务账号。

最强的保证是**数据库账号本身只读**。如果有只读账号，在 `~/.claude.json` 里单独加一个条目（比如 `mongodb-prod-ro`），报告里用这个名字即可。

## 网络

- **内网直连**（默认）：同事访问 `http://<作者内网IP>:8787`。先让对方在浏览器打开 `/health`，看到 `{"error":"unauthorized"}` 就说明网络是通的。
- **跨网段 / 远程**：用 `rqb serve --local`，前面再加一层隧道（Tailscale Funnel / cloudflared）。使用前先确认是否符合公司 IT 政策。
- 内网直连走明文 HTTP，个人口令在网络上没有加密；不用的时候请关掉服务。

## 限制

- **作者的电脑要开着**，`rqb serve` 要一直在跑。
- **耗时和成本**：每个新话题都要带上整段会话上下文，大约 15 秒到 2 分钟，花费 $0.3–1.5；同一话题里的追问会便宜一些。用 `rqb stats` 查看。
- **fork 出来的会话**：`entrypoint=sdk-cli`，`/resume` 列表默认不显示。面板顶部会显示会话 ID，作者可以用 `claude --resume <id>` 打开查看。注意，这样打开就是用作者自己的完整权限在操作这个会话。

## 给 Claude Code 的约定（作者可以写进自己的 CLAUDE.md）

> 生成需要分享的 HTML 报告后，用 `rqb report add <html> --id <id>` 登记并注入问答面板。暴露哪些 MCP 和 skill、给哪些人看，要先问作者，默认什么都不暴露。HTML 重新生成后，运行 `rqb inject <html> --id <id>`。表格行等可以引用的元素加上 `data-rqb-ref="<编号>"`，同事选中文字时会自动带上这个编号。

## 测试

```bash
npm test
```
