# Windows 原生版构建说明

本目录用于把「工作流程跟踪工作台」打包成**不依赖 Docker、不依赖 NAS、不联网**的 Windows 本机程序。

## 一、总体思路与取舍

产物形态是「**内置 Node 运行时 + 应用目录 + 启动器**」，再由 Inno Setup 或安装脚本包装成安装包。

为什么不做成单个 exe：

1. Next.js 的 standalone 产物是一个**目录式服务**（`server.js` + `.next/` + `node_modules/`），运行时按 manifest 动态 `require` 服务端模块。Node 自带的 SEA（Single Executable Application）只能内嵌并加载内置模块，无法在 exe 内加载磁盘上的应用代码，因此没法把整个 Next 服务塞进一个 exe。
2. 用 `pkg` 一类工具把 Next 打进单文件，依赖它对动态 `require` 的静态分析，实际运行常在 `next-server` 或 `image-optimizer` 处崩掉，不适合当交付形态。
3. Electron 之外的 Node 桌面程序（如各类本地服务型工具）普遍采用「运行时 + 资源目录」的布局，本方案与之相同。

因此「独立 exe」这一诉求落在两个层面：

- **安装包是单个 exe**：`WorkflowTracker-Setup-<版本>.exe`，双击安装，开始菜单/桌面快捷方式齐全，可在「设置 → 应用」里卸载。
- **便携版是单个 zip**：解压即用，双击 `启动工作台.cmd` 运行，不需要安装。

两者运行的都是同一份产物目录。

## 二、产物目录结构

```
工作流程跟踪工作台-win-x64\
├─ 启动工作台.cmd          前台启动，关窗即停
├─ 停止工作台.cmd          停止后台实例
├─ 查看状态.cmd            进程/端口/数据库状态
├─ 安装到本机.cmd          安装到 %LOCALAPPDATA%（免管理员）
├─ config.json             运行配置
├─ 使用说明.txt
├─ app\                    ← 应用本体
│  ├─ server.js            Next standalone 入口
│  ├─ package.json
│  ├─ .next\               server 代码 + static 静态资源
│  ├─ public\
│  └─ node_modules\        已被 Next 文件追踪裁剪过的运行依赖
├─ runtime\
│  └─ node.exe             内置 Node 运行时（约 80 MB）
├─ launch\
│  ├─ launcher.js          启动器（端口探测、健康等待、开浏览器、进程管理）
│  ├─ install.ps1          安装脚本
│  ├─ uninstall.ps1        卸载脚本
│  └─ 卸载.cmd
└─ data\                   ← 首次启动自动创建，唯一的数据落点
   ├─ workflow.db          SQLite 主库
   ├─ workflow.db-wal
   ├─ workflow.db-shm
   ├─ launcher.pid
   └─ 初始密码.txt         仅首次启动生成，改密后可删
```

安装到本机后，目录变为 `%LOCALAPPDATA%\Programs\WorkflowTracker\`，结构完全一致。

## 三、依赖处理

| 依赖 | 处理方式 |
|---|---|
| Next.js / React / docx / date-fns | 由 `next build` 的 `output: 'standalone'` 自动追踪并复制进 `app\node_modules`，只带运行必需的文件 |
| `node:sqlite` | Node 内置模块，**没有原生编译依赖**。这是选择它而非 better-sqlite3 的关键：Windows 侧无需 MSVC / node-gyp，也不需要随包分发 `.node` 二进制 |
| Node 运行时 | 从构建机现有安装复制（`--node-exe` 可指定）。**不联网下载**，适配内网环境 |
| sharp / 图片优化 | 本项目未使用 `next/image`，`@img/*` 不参与运行。若构建机上存在该包，应在打包前删除 `app\node_modules\@img`，避免把其他平台的原生库带进分发（约省 40 MB） |
| 字体 | Word 导出只写字体名（方正小标宋简体 / 仿宋_GB2312 / 楷体_GB2312），由阅读端字体决定呈现，无需打包字体文件 |

版本约束：

- 内置运行时必须是 **Node ≥ 22.5**（`node:sqlite` 起始版本）。
- Node 22 需要 `--experimental-sqlite`，Node 24 起不需要。启动器会读取 `runtime\node.exe -v` 自动判断，无需人工配置。

## 四、运行时要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 1809 及以上 / Windows 11（x64）。ARM64 需替换为 `node.exe` 的 arm64 版本 |
| 管理员权限 | **不需要**。整机安装在当前用户目录，便携版直接运行 |
| 端口 | 默认 `127.0.0.1:13681`，只监听本机回环，不触发防火墙提示。端口被占时启动器自动顺延最多 30 个 |
| 磁盘 | 程序约 150 MB；数据按实际使用增长（千条工作记录量级约 1–3 MB） |
| 内存 | 常驻约 60–90 MB |
| 网络 | 运行期完全离线可用。仅当配置了大模型接入时才需要访问对应接口 |
| 其他 | 无需预装 Node、无需 Docker、无需 .NET 运行时 |

## 五、打包配置

### config.json

```json
{
  "port": 13681,
  "host": "127.0.0.1",
  "openBrowser": true,
  "dataDir": "data",
  "vaultDir": "",
  "adminUsername": "admin",
  "adminDisplayName": "系统管理员",
  "adminPassword": "",
  "cookieSecure": false,
  "extraEnv": {}
}
```

| 字段 | 说明 |
|---|---|
| `port` / `host` | 监听端口与地址。`127.0.0.1` 仅本机；改 `0.0.0.0` 可局域网访问 |
| `openBrowser` | 就绪后是否自动打开默认浏览器 |
| `dataDir` | 相对路径基于程序根目录；也可写绝对路径，把数据放到别的盘 |
| `vaultDir` | Obsidian 知识库路径，等价于环境变量 `VAULT_DIR`。留空则用界面上的设置 |
| `adminPassword` | 仅首次初始化数据库时生效。留空则启动器随机生成 16 位密码并写入 `data\初始密码.txt` |
| `cookieSecure` | 走 HTTPS 反向代理时设为 `true` |
| `extraEnv` | 原样注入为环境变量，用于透传 `DB_FILE` 等非常用项 |

### 环境变量映射

启动器把配置翻译成与 Docker 版**完全相同**的环境变量，因此两版行为一致：

| 环境变量 | Windows 版取值 |
|---|---|
| `PORT` | `config.port`（默认 13681） |
| `HOSTNAME` | `config.host`（默认 127.0.0.1；Docker 版为 0.0.0.0） |
| `DATA_DIR` | `<程序根目录>\data` |
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `COOKIE_SECURE` | `config.cookieSecure` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | 首次初始化管理员，仅数据库为空时生效 |
| `VAULT_DIR` | `config.vaultDir`（可选） |

## 六、构建步骤

前提：构建机已装 Node 22 或 24，且在仓库根目录执行过 `npm install`。

```bash
# 完整构建（next build + 组装 + 打 zip）
node build/windows/build-windows.mjs

# 指定内置的 node.exe
node build/windows/build-windows.mjs --node-exe "C:\Program Files\nodejs\node.exe"

# 复用已有构建产物，只重新组装（改启动器时用）
node build/windows/build-windows.mjs --skip-build

# 生成安装包（需先装 Inno Setup 6）
node build/windows/build-windows.mjs --skip-build --installer

# 只要目录，不要 zip
node build/windows/build-windows.mjs --no-zip
```

产物输出到 `outputs/win-dist/`。

### 生成安装包的两种方式

1. **Inno Setup（推荐，产出单文件 Setup.exe）**
   安装 Inno Setup 6 后执行 `--installer`，或用 ISCC 手工编译 `build/windows/installer.iss`。
   该配置按当前用户安装（`PrivilegesRequired=lowest`），不弹 UAC，排除 `data` 目录，卸载时保留数据。

2. **免安装的安装脚本**
   便携版里附带 `安装到本机.cmd`，走 `launch\install.ps1`：
   复制到 `%LOCALAPPDATA%\Programs\WorkflowTracker`、建开始菜单与桌面快捷方式、写入「应用和功能」卸载项。
   支持 `-AutoStart`（开机自启）与 `-NoDesktop`（不建桌面图标）。

## 七、与 Docker 版的一致性

两版**共用同一套源码与同一个 Next standalone 产物**，差异只在进程与路径封装：

| 能力 | Docker 版 | Windows 版 | 是否一致 |
|---|---|---|---|
| 工作管理、进展记录、归档销号 | ✓ | ✓ | 一致 |
| 例行固定工作（天/周/月/季/半年/年） | ✓ | ✓ | 一致 |
| SQLite 数据存储 | `/app/data/workflow.db` | `<程序目录>\data\workflow.db` | 同一套 schema，文件可互拷 |
| 报告生成与大模型接入 | ✓ | ✓ | 一致（同一套提示词与统计逻辑） |
| Word 导出（公文排版） | ✓ | ✓ | 一致 |
| Obsidian 写回 | `/vault` 挂载点 | 本机任意目录 | 逻辑一致，路径来源不同 |
| 多用户与权限 | ✓ | ✓ | 一致 |
| 访问入口 | 容器映射端口 | 本机回环端口 | 一致（浏览器访问） |
| 停止方式 | `docker compose down` | 关窗 / `停止工作台.cmd` | 各自适配 |

数据迁移：把 Docker 版 `data/` 里的三个 `workflow.db*` 文件拷到 Windows 版 `data/`，直接可用。

## 八、已知限制

1. **单机单实例**。启动器用 pid 文件 + 健康探测保证不重复起服务；端口被其他程序占用时自动顺延。
2. **无托盘图标**。未引入原生依赖，因此不做系统托盘；后台运行靠 `--daemon` + 「停止工作台.cmd」。
3. **关闭窗口即停服务**。前台模式是「一个窗口 = 一个服务」，这是刻意的简单化设计，避免后台进程无人管理。
4. **sharp 未内置**。若以后启用 `next/image`，需把对应平台的 `@img/sharp-win32-x64` 一并放入 `app\node_modules`，否则图片优化接口会报错。
5. **首次密码只出现一次**。`data\初始密码.txt` 是唯一留档，登录后请立即改密并删除该文件；也可以在 `config.json` 里预置 `adminPassword`。
