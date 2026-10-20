# 工作流程跟踪工作台

本地化部署的工作管理与总结报告系统。全部数据存放在本地 SQLite 文件，不依赖任何外部云服务；支持接入任意 OpenAI 兼容大模型，自动生成单项及周期性工作总结报告。

---

## 一、功能概览

### 工作管理
- 手动添加工作，记录**工作详情**、**完成条件**、**DDL**、优先级、责任人、标签
- 每项工作可随时追加**进展记录**（含进度百分比），形成完整时间线
- 未完成工作按「今日到期 / 3 日内到期 / 已逾期」三类分级提醒
- 已完成工作支持**销号**（标记完成）与**归档**，归档后仍保留全部数据，可随时恢复
- **两类工作**：新增工作时可区分「一次性工作」与「例行固定工作」

### 例行固定工作
一直存在的定期动作，选定周期后系统按周期自动排进待办，不需要每次手工新建。

| 周期 | 到期设定 | 提前进入待办 |
|---|---|---|
| 每天 | 每天 | 1 天 |
| 每周 | 指定星期 | 7 天 |
| 每月 | 指定日（超出当月天数按月末） | 7 天 |
| 每季度 | 季末月（3/6/9/12）指定日 | 14 天 |
| 每半年 | 半年末月（6/12）指定日 | 21 天 |
| 每年 | 指定月、日 | 30 天 |

- 支持**顺延天数**（可填负数表示提前）
- **每个周期只生成一次**，用周期标识幂等去重，不会重复堆积
- 新建后立即生成当期工作；若当期到期日已过，自动顺延到下一个到期周期，不会一建出来就是逾期任务
- **只生成当期，不追溯补发**：几天没打开系统，不会凭空补出若干条历史逾期任务；上一个周期没做完的那条仍留在待办里照常提醒
- 工作列表中以「例行」标记区分；例行工作页可查看每个模板「本周期」的生成与完成状态

### 提醒机制
- **后台定时推送**：服务进程内自带提醒循环，每 30 分钟检查一次，到「每日推送时刻」（默认 09:00）自动推送一次；**不需要有人打开页面**
- **站内待办中心**：首页重点待办、侧边栏红点、顶部导航角标
- **浏览器桌面通知**：页面打开时对逾期项推送系统通知
- **Webhook 推送**：支持企业微信 / 钉钉 / 飞书群机器人及通用 JSON

循环在服务收到第一个请求时启动（Docker 健康检查每 30 秒打一次 `/api/health`，桌面版启动时也会轮询，因此几秒内即被唤醒），启动后常驻，与是否有人访问无关。设 `REMINDER_LOOP=0` 可关闭。

推送幂等由两层保证：站内通知靠 `dedupe_key`，推送靠 `remind.lastRunDate`。因此进程内定时、外部触发接口、手工触发同时打进来也不会重复推。需要外部定时器时可以调用 `POST /api/jobs/remind`（须配 `JOB_TOKEN` 并带 `x-job-token` 头），适合多副本或容器休眠场景。

### 大模型报告
- 报告范围：**单项工作**、**周**、**月**、**半年**、**年**、**自定义区间**
- 生成策略：先由系统计算确定性统计（完成率、逾期数、标签分布等），再连同工作明细与进展记录交给模型，提示词强制要求「不得编造材料中未出现的事实与数字」
- 导出格式：**Word**（严格套用公文格式）、**Markdown**（带 Obsidian frontmatter）、**PDF**（浏览器打印）
- 生成结果自动入库，正文可在页面内二次编辑后再导出

### Obsidian 集成
- **只读检索**：挂载 vault 目录，按关键词检索笔记标题与正文，供报告素材参考
- **报告写回**：将生成的报告写为带 frontmatter 的 `.md`，落入指定子目录，同名文件自动加序号，绝不覆盖

### 多用户与权限
- 两级角色：**管理员**（管理用户、查看全部工作、修改系统配置）、**成员**（仅查看与操作分配给自己的工作）
- 密码 scrypt 加盐哈希，会话存 cookie + 服务端校验表，支持强制下线

---

## 二、技术架构

| 维度 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 15（App Router） | 前后端一体，单进程单端口 |
| 运行时 | Node.js 24 Alpine | 内置 `node:sqlite`，**无原生编译依赖** |
| 数据库 | SQLite（WAL 模式） | 文件落 NAS 本地目录，支持热备 |
| 样式 | 原生 CSS 变量 | 宫墙红 + 鎏金配色，无 UI 框架依赖 |
| 文档导出 | docx 库 | 按公文规范生成，页边距/字体/行距全部写死 |
| 镜像 | 多阶段构建 | 运行镜像约 200MB，内存占用约 150–250MB |

> **关于 SQLite 的选型说明**
> 未采用 `better-sqlite3`，原因是它需要本地编译原生模块，在 Alpine 与 ARM 平台均需额外工具链，且镜像体积增加约 30MB。
> Node 22.5 起内置 `node:sqlite`，Node 24 已稳定，API 足够覆盖本项目全部需求（预编译语句、事务、WAL），因此改用它，实现**零编译依赖、x86/ARM 通用**。

---

## 三、Windows 桌面版（免 Docker）

交付物是**单个安装程序 `WorkflowTracker-Desktop-Setup-1.0.0.exe`**（121 MB），双击安装，之后从开始菜单或桌面启动。**这是独立桌面窗口程序，不在浏览器里打开**：有自己的图标、任务栏项、窗口菜单，没有地址栏。

运行不依赖 Docker、不依赖 Node、不需要管理员权限；数据落在本机 `%APPDATA%\工作流程跟踪工作台\data`。

### 使用方式

| 形态 | 文件 | 说明 |
|---|---|---|
| 桌面版（推荐） | `WorkflowTracker-Desktop-Setup-1.0.0.exe` | 独立窗口程序，安装后从开始菜单启动 |
| 服务版（可选） | `WorkflowTracker-Setup-1.0.0.exe` | 同一套界面，跑在本机服务里，用浏览器访问 |

首次启动自动生成管理员密码，弹窗提示一次，同时留存在 `data\初始密码.txt`，登录后请立即改密。

### 桌面版与浏览器版的区别

- 桌面版把服务与界面打包在一起：界面用 Chromium 渲染在应用自己的窗口里，不经过系统浏览器。
- 两者共用同一份 Next 构建产物与同一套 SQLite 数据格式，数据目录可互拷。

### 目录结构

```
工作流程跟踪工作台-win-x64\
├─ 启动工作台.cmd / 停止工作台.cmd / 查看状态.cmd
├─ 安装到本机.cmd          安装到 %LOCALAPPDATA%（免管理员）
├─ config.json             端口、数据目录、Obsidian 路径等
├─ app\                    应用本体（Next standalone + 依赖）
├─ runtime\node.exe        内置 Node 运行时
├─ launch\                 启动器与安装/卸载脚本
└─ data\                   唯一数据落点（workflow.db）
```

### 构建

```bash
node build/windows/build-windows.mjs                 # 完整构建
node build/windows/build-windows.mjs --installer     # 顺带生成 Setup.exe（需 Inno Setup 6）
```

安装包只是一个「外壳」：真正运行的是同一份目录产物，与 Docker 版共用同一套源码和同一个 Next standalone 输出。各项参数、环境变量映射、已知限制见 [`build/windows/README.md`](build/windows/README.md)。

### 与 Docker 版的取舍

- 监听地址：Windows 版默认只绑 `127.0.0.1`（仅本机），Docker 版绑 `0.0.0.0`（容器内网）。
- 数据位置：Windows 版在程序目录 `data\`，Docker 版挂载到 `/app/data`。两者 schema 相同，三个 `workflow.db*` 文件可直接互拷。
- 进程管理：Windows 版一个窗口对应一个服务，不做系统托盘，避免引入原生依赖。

## 四、NAS 部署

### 前置条件
- 目标机器为 x86_64 架构，Linux 内核，已装 Docker
- 已安装 Docker 与 Docker Compose 插件

### 部署步骤

**1. 克隆到 NAS**

```bash
cd /volume1/docker
git clone https://github.com/你的用户名/workflow-tracker.git
cd workflow-tracker
```

若 NAS 上没有 git，也可在电脑上下载 ZIP 后通过文件管理上传解压。

**2. 一键部署**

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本会自动完成：生成 `.env`（含随机管理员密码）→ 建数据目录 → 构建镜像 → 启动 → 等健康检查 → 打印访问地址和初始密码。

首次构建约 3–6 分钟。

**3. 手动部署（若不使用脚本）**

```bash
cp .env.example .env
# 编辑 .env，至少改 ADMIN_PASSWORD 和 DATA_PATH
docker compose up -d --build
```

**4. 访问**

浏览器打开 `http://NAS的IP:3080`，用脚本输出的管理员账号登录。

**5. 首次登录后的配置**

| 顺序 | 位置 | 动作 |
|---|---|---|
| 1 | 系统设置 → 修改密码 | 改掉初始密码 |
| 2 | 系统设置 → 大模型接入 | 填接口地址、API Key、模型名，点「测试连接」 |
| 3 | 系统设置 → Obsidian 知识库 | 填 `/vault`，点「检测路径」 |
| 4 | 用户管理 | 为同事创建账号 |

**6. 配置项什么时候改**

| 配置 | 部署后可否在界面改 | 说明 |
|---|---|---|
| Obsidian 路径 | 可以 | 界面设置优先于环境变量，改完即生效，无需重启 |
| 知识库挂载点 | 不可以 | 容器只能访问已挂载目录，须改 compose 后 `docker compose up -d` |
| 账号密码 | 可以 | 系统设置 → 修改密码；也可用 `./deploy.sh reset-pwd 用户名 新密码` |
| `ADMIN_PASSWORD` | 仅首次生效 | 数据库已存在账号时改环境变量无效 |
| 数据目录 | 不可以 | 改 `DATA_PATH` 等于换新库，旧数据需手工迁移 |
| 端口 | 改 compose 后重启 | 改 `APP_PORT` 后 `docker compose up -d` |

**挂载 Obsidian 知识库**

`docker-compose.yml` 里对应的 volume 默认是注释掉的。不想改动仓库原文件时，新建同目录的 `docker-compose.override.yml`，compose 会自动合并：

```yaml
services:
  workflow-tracker:
    volumes:
      - /volume2/你的路径/个人知识库:/vault:rw
```

然后 `docker compose up -d` 使其生效。**建议挂载知识库的父目录**，登录后在界面里选择具体子库，这样换库不必重建容器。只读检索用 `:ro` 即可；需要「报告写回」则必须是 `:rw`。

---

## 五、数据存储与备份

数据库文件位置：`.env` 中 `DATA_PATH` 指定的目录下的 `workflow.db`（默认 `./data`）。

**备份**：

```bash
./deploy.sh backup
```

脚本会打包整个 data 目录为 `backup-YYYYMMDD-HHMMSS.tar.gz`。

WAL 模式下有 `workflow.db`、`workflow.db-wal`、`workflow.db-shm` 三个文件，**必须一起备份**，否则可能丢失最近事务。脚本已包含全部三个文件。

**恢复**：`docker compose down` → 解压备份覆盖 data 目录 → `docker compose up -d`。

---

## 六、大模型接入示例

### DeepSeek

| 配置项 | 值 |
|---|---|
| 接口地址 | `https://api.deepseek.com` |
| 模型名称 | `deepseek-chat` |
| 温度 | 0.4 |

### 通义千问（DashScope 兼容模式）

| 配置项 | 值 |
|---|---|
| 接口地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 模型名称 | `qwen-plus` 或 `qwen-max` |

### 本地 Ollama（完全离线）

| 配置项 | 值 |
|---|---|
| 接口地址 | `http://NAS的IP:11434/v1` |
| API Key | 随意填（Ollama 不校验） |
| 模型名称 | `qwen2.5:7b` 等已拉取的模型 |

> 若模型与工作台不在同一容器网络，需用 NAS 的局域网 IP，不能用 `127.0.0.1`。
> 低功耗 CPU 跑 7B 级模型推理速度约 3–6 token/s，生成一份 1500 字报告约需 3–6 分钟，建议优先用云端接口。

---

## 七、本地开发

```bash
npm install
npm run dev        # http://localhost:3080
npm run build      # 生产构建（类型检查已开启，类型不干净会直接失败）
npm start          # 启动生产服务

npm run typecheck  # tsc --noEmit
npm run test:unit  # 周期推导 42 项断言
```

改一行文案不想等镜像重建时，用开发编排（源码挂载 + 热更新，不构建镜像）：

```bash
docker compose -f docker-compose.dev.yml up
```

开发环境变量（可选，写在 `.env.local`）：

```bash
DATA_DIR=./data
ADMIN_USERNAME=admin
ADMIN_PASSWORD=                 # 留空则首次启动生成随机口令，写入 data/initial-password.txt
VAULT_DIR=/path/to/your/vault   # Obsidian 知识库根目录，也可登录后在界面上改
REMINDER_LOOP=0                 # 本地开发建议关掉后台定时推送
```

### 持续集成

`.github/workflows/ci.yml` 在每次 push / PR 跑：`npm ci` → `typecheck` → `test:unit` → `build`。
需要活服务的三个脚本（`e2e-test.cjs`、`test-obsidian.cjs`、`test-maintainability.cjs`）不在 CI 里跑，属于部署后的冒烟环节。

---

## 八、目录结构

仓库顶层：

```
├── src/                    # 应用源码（见下）
├── build/windows/          # Windows 原生版打包：构建脚本、启动器、安装/卸载、Inno Setup 配置
├── scripts/                # 测试与示例数据脚本
├── Dockerfile              # Docker 镜像构建
├── docker-compose.yml      # NAS 部署编排
├── deploy.sh               # 一键部署脚本
└── outputs/                # 构建产物（不入库）
```

源码：

```
src/
├── app/
│   ├── (app)/              # 需登录的页面
│   │   ├── page.tsx        # 工作台概览
│   │   ├── tasks/          # 工作列表与详情
│   │   ├── reports/        # 报告列表、生成、详情
│   │   ├── templates/      # 例行工作（周期规则）
│   │   ├── notifications/  # 待办提醒
│   │   ├── calendar/       # 日历视图
│   │   ├── tags/           # 标签管理
│   │   ├── obsidian/       # 知识库浏览
│   │   └── settings/       # 系统设置、用户管理
│   ├── api/                # 全部后端接口
│   └── login/              # 登录页
├── components/             # Shell 布局、通用 UI
├── lib/
│   ├── db.ts               # 数据库连接与建表
│   ├── auth.ts             # 密码、会话、权限
│   ├── tasks.ts            # 工作查询与写入
│   ├── templates.ts        # 周期模板生成
│   ├── reminders.ts        # 提醒扫描与推送
│   ├── reports.ts          # 报告生成（提示词在此）
│   ├── llm.ts              # OpenAI 兼容客户端
│   ├── export.ts           # Word / Markdown / 打印 HTML
│   ├── obsidian.ts         # 知识库检索与写回
│   └── date.ts             # 日期与周月年区间
└── middleware.ts           # 路由守卫
```

---

## 九、注意事项

1. **首次启动后必须修改初始管理员密码**，尤其是在端口可能暴露的情况下。
   未设置 `ADMIN_PASSWORD` 时系统会生成随机口令并写入 `data/initial-password.txt`（权限 0600），不再有 `admin123456` 这类默认口令兜底。登录并改密后请删除该文件。
2. **登录失败会节流**：同一用户名 + IP 在 5 分钟内失败 5 次即返回 429（带 `Retry-After`），成功登录清零。
   注意 `X-Forwarded-For` 可伪造：直连时按「提高成本」定位；若走反向代理，请让代理**覆盖**该头而不是追加，否则限流会被绕过。
3. **不要删除 `.workbuddy` 目录**（若存在），其中为项目相关数据。
4. 端口冲突时，改 `docker-compose.yml` 中 `ports` 左侧值，如 `3081:3080`。
5. 容器以 `node` 用户（uid 1000）运行，挂载的 data 目录需可写；若 NAS 权限严格，可执行 `chown -R 1000:1000 data`。
   **部分品牌 NAS 需额外 `chmod -R 777 data`**：其 ACL 层对容器进程只认 other 权限位，即使宿主机同 uid 可写，容器内仍会报 `unable to open database file`（健康检查返回 503）。`deploy.sh` 已内置该步骤。
6. 报告生成依赖大模型在线；网络不通或 Key 失效时页面会明确报错，不会静默失败。
7. `outputs/` 目录为交付物输出位置，已在 `.gitignore` 与 `.dockerignore` 中排除。

### 适用边界

本项目按「单实例、≤10 人、单库 ≤100MB」设计：

- 数据库使用 Node 内置 `node:sqlite`（同步 API），单条查询是微秒到毫秒级；超过 100ms 的慢 SQL 会打 `[slow-sql]` 日志，便于事后判断是否需要引入 worker_threads。
- 知识库检索默认走 FTS5 索引（trigram 分词，支持中文子串）；若运行时的 SQLite 未编译 FTS5，会自动回退逐篇匹配，并把探测结果写入 `obsidian.fts` 设置项，不静默降级。
- `node:sqlite` 官方标注为 **Stability 1.2 – Release candidate**，API 仍可能微调；因此 Docker 基础镜像固定 Node 次版本，升级前请先在本机跑 `npm run typecheck && npm run test:unit`。
- 单实例部署，未做多副本写入协调；需要多副本时请只让一个实例开启提醒循环（其余设 `REMINDER_LOOP=0`）。
7. 若 Docker 侧配置了代理（`/etc/docker/daemon.json` 的 `proxies`），镜像拉取会强制走该代理；代理不可用时表现为 `Get "https://registry-1.docker.io/v2/": EOF`。此时可先修好代理，或改为从国内镜像源拉取后 `docker load`。注意 `docker build` 内部的 `npm`／`apk` 走容器网络，不受该代理影响。
