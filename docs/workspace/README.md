# Letta Workspace 新手操作指南

这份文档是写给新的 AI 实习生看的。

目标只有一个：

**让一个刚接手这个项目的人，不需要懂太多历史，也能知道现在该去哪里工作、改哪里、怎么测试、怎么打包、怎么跟 Git / GitHub 配合。**

这份文档优先用中文解释，保留必要的专业术语（English）。

---

## 1. 先用一句话理解这个项目

这个项目现在已经不是“单一仓库 + 单一后端”了，而是一个**桌面产品工作区（workspace）**。

它由几部分组成：

1. 一个主桌面产品 repo  
   也就是 Electron + React 的 `Letta.app`

2. 几个本地 fork 的上游 repo  
   用来承接 Python server、Node CLI、CodeIsland、SDK 的改动

3. 一套运行时目录（runtime）  
   放 Python runtime、构建缓存、打包中间产物

4. 一套发布目录（releases）  
   放最终给用户安装的 `.zip` / `.dmg`

所以你不要把它理解成“一个普通前端项目”，它更像一个**桌面产品总装车间**。

---

## 2. 最重要的结论：以后该进哪个目录？

以后正常工作，只进这个目录：

- `/Users/jachi/Desktop/letta-workspace`

这是**新的主工作区（primary workspace）**。

旧目录：

- `/Users/jachi/Desktop/letta-archive`

现在只是**旧归档区（archive）**，只做这三件事：

1. 看历史代码
2. 查旧文档
3. 紧急对照参考

**不要再把旧归档区当成正常开发目录。**

如果你不确定自己有没有进错地方，先在新工作区根目录跑：

```bash
./scripts/doctor.sh
```

---

## 3. 这个 workspace 里面每个目录是干嘛的？

### 根目录结构

在 `/Users/jachi/Desktop/letta-workspace` 下，最重要的是这几个目录：

- `app/`
- `vendor/`
- `runtime/`
- `releases/`
- `docs/`
- `scripts/`

下面逐个说。

### 3.1 `app/`

路径：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

这是**主产品 repo（primary product repo）**。

它负责：

- Electron main process
- React UI
- 设置页（Settings / onboarding）
- 打包 Letta app
- 拉起内置 Python Letta server
- 拉起内置 CodeIsland
- release 验收脚本

**绝大部分新功能，应该先从这里开始改。**

如果你拿不准从哪里下手，默认先看这里。

### 3.2 `vendor/`

这是**上游 fork 区（vendor forks）**。

里面每个 repo 都有明确职责。

#### `vendor/letta-monorepo`

路径：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`

这是 Python Letta server 的源码仓。

改它的时机：

- Python server 行为有问题
- provider 逻辑有问题
- agent / tool / API server 行为有问题
- bundled server 本身需要修

#### `vendor/letta-code`

路径：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`

这是 Node CLI runtime 的 fork。

改它的时机：

- `letta-code` CLI 行为有问题
- compatible provider / BYOK / custom `base_url` 有问题
- Node runner 和 Letta app 的 CLI 集成有问题

#### `vendor/code-island`

路径：

- `/Users/jachi/Desktop/letta-workspace/vendor/code-island`

这是 CodeIsland 的 fork。

改它的时机：

- notch UI 有问题
- Letta 状态显示不对
- CodeIsland 动画、session 展示、激活逻辑有问题

#### `vendor/letta-code-sdk-local`

路径：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk-local`

这是一个很小的本地 SDK patch 仓库。

改它的时机：

- SDK 的 CLI path resolution 有问题
- 打包后的 SDK 找错 CLI
- 它和 Electron 的 glue code 有问题

如果不是这类问题，尽量不要先改这里。

### 3.3 `runtime/`

路径：

- `/Users/jachi/Desktop/letta-workspace/runtime`

这是**运行时目录**，不是源码目录。

里面最重要的是：

- `/Users/jachi/Desktop/letta-workspace/runtime/python/venv`

这里放的是打包/运行需要的 Python runtime。

请记住：

**runtime 不是 source of truth。**

也就是说：

- 可以被重建
- 不应该当“正式源码”去维护
- 不要把业务逻辑直接写在这里面

### 3.4 `releases/`

路径：

- `/Users/jachi/Desktop/letta-workspace/releases`

这里放最终发布产物：

- `.zip`
- `.dmg`

这些是给用户安装的，不是源码。

### 3.5 `docs/`

路径：

- `/Users/jachi/Desktop/letta-workspace/docs`

这里放的是工作区级说明文档。

### 3.6 `scripts/`

路径：

- `/Users/jachi/Desktop/letta-workspace/scripts`

这里放根目录快捷脚本，目的就是：

**让你不用记复杂命令。**

---

## 4. 先看哪些文档？

如果你是第一次接手，建议按这个顺序看：

1. 先看这份 `README.md`
2. 再看：
   - `/Users/jachi/Desktop/letta-workspace/START-HERE.md`
3. 再看：
   - `/Users/jachi/Desktop/letta-workspace/docs/current-state.md`
4. 然后看：
   - `/Users/jachi/Desktop/letta-workspace/docs/repo-ownership.md`
5. 最后看：
   - `/Users/jachi/Desktop/letta-workspace/docs/update-playbook.md`

如果要看“版本化、跟主产品 repo 一起保存”的文档副本，看这里：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/docs/workspace/README.md`

它下面还有完整副本：

- `current-state.md`
- `migration-status.md`
- `repo-ownership.md`
- `update-playbook.md`
- `workspace-map.md`

---

## 5. 最常用脚本怎么跑？

所有这些命令都在：

- `/Users/jachi/Desktop/letta-workspace`

根目录执行。

### 5.1 检查工作区是否正常

```bash
./scripts/doctor.sh
```

它会告诉你：

- app repo 在不在
- vendor repos 在不在
- runtime 在不在
- releases 目录在不在
- 当前大概占多少空间

### 5.2 快速看所有 repo 的 git 状态

```bash
./scripts/repo-status.sh
```

它会显示几个 repo 当前：

- 在哪个 branch
- 有没有未提交改动

这个脚本非常适合在开始工作前先跑一次。

### 5.3 启动开发环境

```bash
./scripts/dev.sh
```

它最终会进入：

- `app/letta-desktop`

然后跑：

- React 开发服务
- Electron 开发模式

### 5.4 打包 release

```bash
./scripts/build-release.sh
```

它会做的事情包括：

- sync `letta-code`
- build bundled Letta server
- build bundled CodeIsland
- transpile Electron
- build React
- 打出 macOS arm64 产物

### 5.5 做自动验收

```bash
./scripts/verify-release.sh
```

它会做的事情包括：

- verify staged Letta server
- smoke Letta server
- release-check app bundle

这是**打包后必须跑**的脚本。

### 5.6 做“同机首装复测”

```bash
./scripts/retest-first-install.sh
```

它会做的事情包括：

- 停掉正在运行的 `Letta` / `CodeIsland` / `letta.js`
- 删除 `/Applications/Letta.app`
- 删除这批核心残留：
  - `~/Library/Application Support/Letta`
  - `~/Library/Application Support/Letta Code`
  - `~/Library/Application Support/letta-cowork`
  - `~/.letta`
  - `~/.codeisland`
  - `~/Documents/.letta`
- 删除这批更容易漏掉的残留：
  - `~/Library/Caches/com.codeisland.app`
  - `~/Library/HTTPStorages/com.codeisland.app`
  - `~/Library/Preferences/com.codeisland.app.plist`
  - `~/Library/Preferences/com.jachi.letta.plist`
  - `~/Library/Saved Application State/com.jachi.letta.savedState`
  - `~/Library/Saved Application State/com.codeisland.app.savedState`
  - `~/Library/Logs/Letta`
  - `~/Library/Logs/CodeIsland`
- 把最新的 `.dmg` / `.zip` 从
  `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/dist`
  复制到
  `/Users/jachi/Desktop/letta-workspace/releases`
- 打印下一步应该手工测试哪个安装包

它不会自动打开 app，也不会替你走安装流程。  
它的作用是把当前机器尽量清回“接近首次安装”的状态，并把待测安装包统一放到 `releases/`。

脚本返回 `PASS` 的标准是：

- `/Applications/Letta.app` 不存在
- 上面列出的 Letta / CodeIsland 残留路径都不存在
- 没有 `Letta` / `CodeIsland` / `letta.js` 相关运行进程
- 最新 `.dmg` / `.zip` 已复制到 `releases/`

如果脚本最后返回 `FAIL`，就不要开始手工首装测试。

---

## 6. 如果要新增功能，应该从哪里开始？

这是最容易混乱的地方。

### 规则 1：默认先从 `app/letta-desktop` 开始

大多数需求应该先从这里开始：

- UI 改动
- Electron 主进程逻辑
- 设置页
- 打包逻辑
- 启动内置 server / CodeIsland
- release 验证

路径：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

### 规则 2：只有“底层能力”有问题，才去改 `vendor/`

#### 去 `vendor/letta-monorepo`

如果问题属于：

- Python Letta server
- provider server 逻辑
- tool / agent / API server

#### 去 `vendor/letta-code`

如果问题属于：

- Node CLI runtime
- BYOK
- compatible provider
- custom `base_url`

#### 去 `vendor/code-island`

如果问题属于：

- CodeIsland UI
- notch 展示
- 会话状态动画
- 激活和自愈

#### 去 `vendor/letta-code-sdk-local`

如果问题属于：

- SDK 查找 CLI 的路径逻辑
- 打包后 SDK glue 行为

### 规则 3：不要把功能代码直接写进 `runtime/` 或 `releases/`

这两个目录都不是写业务逻辑的地方。

---

## 7. 源码是怎么存放的？

现在源码不是“全在一个 repo 里”，而是分层存放。

### 你应该把它想成两层

#### 第一层：主产品源码

- `app/letta-desktop`

这是桌面产品总装层。

#### 第二层：上游 fork 源码

- `vendor/letta-monorepo`
- `vendor/letta-code`
- `vendor/code-island`
- `vendor/letta-code-sdk-local`

这是底层能力层。

这意味着：

- 产品逻辑改 `app`
- 底层逻辑改 `vendor`

---

## 8. 怎么测试？

### 8.1 最低要求测试

如果你改了任何会影响打包或运行的东西，最少要跑：

```bash
./scripts/verify-release.sh
```

### 8.2 如果你改的是 app 层

进入：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

常用命令：

```bash
bun run test
bun run test:run
bun run transpile:electron
bun run build
```

### 8.3 如果你改的是 bundled server 相关

根目录跑：

```bash
./scripts/build-release.sh
./scripts/verify-release.sh
```

或者在 app repo 内跑：

```bash
bun run build:letta-server
bun run verify:letta-server
bun run smoke:letta-server
```

### 8.4 如果你改的是 `letta-code`

进入：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`

再跑它自己的 build / test。

然后回到主工作区，重新打包并验收。

---

## 9. 怎么打包？

最简单的做法：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/build-release.sh
./scripts/verify-release.sh
```

打包完成后，`electron-builder` 的原始输出目录是：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/dist`

这里会包含：

- `dist/mac-arm64/Letta.app`
- `dist/Letta-*.dmg`
- `dist/Letta-*-mac.zip`

但日常验收和对外投放时，建议统一使用：

- `/Users/jachi/Desktop/letta-workspace/releases`

推荐做法：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/retest-first-install.sh
```

这个脚本会把当前最新的 `.dmg` / `.zip` 复制到 `releases/`，并把机器清到“接近首次安装”的状态。

你也可以看 app repo 里的中间产物：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/dist`

但要严格区分：

- `dist/mac-arm64/Letta.app` 只用于 **Bundle Smoke**
- `.dmg` / `.zip` 只用于 **Installer First Run**
- 最终发布和手工验收统一以 `releases/` 为准

### 9.1 两种测试必须严格分开

#### A. Bundle Smoke

只允许使用：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/dist/mac-arm64/Letta.app`

目标：

- 验证 app bundle 本体能不能跑
- 验证 bundled LettaServer / CodeIsland / SDK / runtime 是否完整

这一步不能代表普通用户安装链路没问题。

#### B. Installer First Run

只允许使用：

- `/Users/jachi/Desktop/letta-workspace/releases/Letta-*.dmg`
- `/Users/jachi/Desktop/letta-workspace/releases/Letta-*-mac.zip`

目标：

- 验证用户下载、安装、首次启动、首次配置、首次对话是否完整成功

这一步才是“普通用户首装模拟”。

### 9.2 安装包首装验收清单

#### 清理前置步骤

先执行：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/retest-first-install.sh
```

然后确认：

- 不要打开 `dist/mac-arm64/Letta.app`
- `/Applications/Letta.app` 已删除
- `Letta` / `CodeIsland` 相关进程已停止
- 待测安装包已经在 `releases/`
- `./scripts/retest-first-install.sh` 最后一行明确返回 `Cleanup complete: PASS`

#### 清单 A：Bundle Smoke

输入物：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/dist/mac-arm64/Letta.app`

通过标准：

- 首次启动能看到配置页
- `API key / Base URL / Model` 能保存
- 第一条消息能收到回复
- 连续 3 条消息都能正常回复
- `CodeIsland` 会自动拉起
- 退出再打开后仍能继续对话

禁止事项：

- 不看 `.dmg`
- 不看 `.zip`
- 不把它当成“普通用户安装测试”

#### 清单 B：DMG 首装

输入物：

- `/Users/jachi/Desktop/letta-workspace/releases/Letta-*.dmg`

步骤：

1. 运行 `./scripts/retest-first-install.sh`
2. 打开 `releases/` 里的 `.dmg`
3. 把 `Letta.app` 拖到 `/Applications`
4. 弹出 DMG
5. 从 Finder 打开 `/Applications/Letta.app`

通过标准：

- 首启能打开主窗口
- 配置可以保存
- 第一条消息就能收到回复
- 连续 3 条消息都正常
- `CodeIsland` 自动拉起
- 退出重开后仍能继续对话

禁止事项：

- 不允许直接从挂载的 DMG 里运行
- 不允许中途启动 `dist/mac-arm64/Letta.app`

#### 清单 C：ZIP 首装

输入物：

- `/Users/jachi/Desktop/letta-workspace/releases/Letta-*-mac.zip`

步骤：

1. 运行 `./scripts/retest-first-install.sh`
2. 解压 `releases/` 里的 `.zip`
3. 把解压出的 `Letta.app` 移到 `/Applications`
4. 从 Finder 打开 `/Applications/Letta.app`

通过标准：

- 首启能打开主窗口
- 配置可以保存
- 第一条消息就能收到回复
- 连续 3 条消息都正常
- `CodeIsland` 自动拉起
- 退出重开后仍能继续对话

说明：

- 如果你额外测试“直接从解压目录启动”，那只是补充测试，不算标准安装路径

#### 清单 D：新 macOS 用户 / 新虚拟机里的最严格首装模拟

这是最严格、最接近真实用户的方式，比“同机清理重测”更可信。

推荐做法：

1. 新建一个全新的 macOS 用户，或者启一个全新的 macOS 虚拟机
2. 不安装任何 Letta 历史版本
3. 不拷贝旧的 `~/Library/Application Support/Letta`、`~/.letta` 等目录
4. 只把 `releases/` 里的 `.dmg` 或 `.zip` 带进去
5. 用 Finder 正常安装
6. 首次打开时填写 `API key / Base URL / Model`
7. 完成第一条对话、连续多轮对话、重启后继续对话验证

最严格通过标准：

- 不依赖旧用户目录
- 不依赖工作区里的 `dist` bundle
- 不依赖本机此前跑过的 Letta 配置
- 不依赖外部单独安装的 `CodeIsland.app`
- 不依赖手工补环境后才能对话

如果你要对外发包，最终应以清单 D 的结果为最高标准。

---

## 10. 当前产品已经做到什么？

当前这一版 `Letta.app` 已经具备：

- 内置 Python Letta server
- 内置 CodeIsland
- 安装后打开 app 会自动拉起它们
- 用户在 app 里填写 `API key / Base URL / Model` 后就能对话
- 不依赖外部 Python
- 不依赖外部 `localhost:8283`
- 不依赖单独安装的 `CodeIsland.app`

所以这已经不是“开发实验”，而是一个能安装、能运行、能继续维护的桌面产品版本。

---

## 11. 旧工作区和新工作区的关系

### 旧工作区

- `/Users/jachi/Desktop/letta-archive`

这是旧混合工作区的归档版。

它现在只是：

1. 历史参考
2. 源码备份
3. 应急对照

### 新工作区

- `/Users/jachi/Desktop/letta-workspace`

这是唯一的正常开发入口。

### 简单理解

旧工作区 = 旧家  
新工作区 = 现在真正住的家

你可以回旧家拿东西，但不要继续在旧家做饭睡觉。

---

## 12. 复杂的 `.git` 结构到底是怎么回事？

这也是最容易让小白晕的地方。

### 先说结论

这个 workspace 不是一个单仓库，而是多个独立 git repo 拼成的工作区。

### 主要的 git repo 有这些

#### 主产品 repo

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

#### vendor repos

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`
- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`
- `/Users/jachi/Desktop/letta-workspace/vendor/code-island`
- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk-local`

### 你该怎么理解它们

不是“嵌套仓库很乱”，而是：

**它们本来就是不同职责的独立 repo。**

只是被放在一个 workspace 里协同工作。

所以以后不要问：

“为什么这里有很多 `.git`？”

正确理解是：

“这是一个 monorepo-like workspace，但不是单一 monorepo。”

---

## 13. GitHub 上这些仓库和本地怎么对应？

### 主产品

本地：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

GitHub：

- `origin = Jiachi-Deng/letta-oss-ui`
- `upstream = letta-ai/letta-oss-ui`

### Python Letta server

本地：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`

GitHub：

- `origin = Jiachi-Deng/letta`
- `upstream = letta-ai/letta`

### Node CLI

本地：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`

GitHub：

- `origin = Jiachi-Deng/letta-code`
- `upstream = letta-ai/letta-code`

### CodeIsland

本地：

- `/Users/jachi/Desktop/letta-workspace/vendor/code-island`

GitHub：

- `origin = Jiachi-Deng/CodeIsland`
- `upstream = wxtsky/CodeIsland`

### SDK 小仓

本地：

- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk-local`

GitHub：

- `origin = Jiachi-Deng/letta-code-sdk-local`

它没有标准官方 upstream，所以这里只有 `origin`。

---

## 14. Git 操作应该怎么做？

### 14.1 改代码前

先看状态：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/repo-status.sh
```

再进入你真正要改的 repo。

### 14.2 拉最新上游

如果你想看上游更新：

```bash
git fetch upstream
```

如果你想看自己 fork 的远程：

```bash
git fetch origin
```

### 14.3 改完代码后

先在对应 repo 里：

```bash
git status
git add ...
git commit -m "your message"
```

然后推到你自己的 fork：

```bash
git push origin main
```

如果不是 `main`，就推当前分支名。

### 14.4 如果你改的是多个 repo

一定要分别提交，不要混。

例如：

- UI 改动在 `app/letta-desktop`
- Python server 改动在 `vendor/letta-monorepo`
- CodeIsland 改动在 `vendor/code-island`

这三个要分别 `commit` 和 `push`。

### 14.5 实习生最常犯的错

1. 在错误的 repo 里提交
2. 改了 `runtime/` 里的东西却没改真正源码
3. 只改 app，不改底层 fork
4. 改完没跑 `verify-release.sh`
5. 在 archive 区改代码

---

## 15. 推荐的日常工作流（最实用）

### 场景 A：改 UI 或桌面行为

1. 进入：
   - `/Users/jachi/Desktop/letta-workspace`
2. 跑：
   - `./scripts/doctor.sh`
3. 跑：
   - `./scripts/repo-status.sh`
4. 去：
   - `app/letta-desktop`
5. 改代码
6. 跑：
   - `bun run test:run`
   - `bun run transpile:electron`
7. 根目录跑：
   - `./scripts/verify-release.sh`
8. 提交并 push

### 场景 B：改 Python server

1. 进入：
   - `vendor/letta-monorepo`
2. 改代码
3. 回根目录
4. 跑：
   - `./scripts/build-release.sh`
   - `./scripts/verify-release.sh`
5. 分别提交 app / vendor 需要的 repo

### 场景 C：改 compatible provider / Node CLI

1. 进入：
   - `vendor/letta-code`
2. 改代码
3. 回根目录重新 build / verify
4. 提交 `vendor/letta-code`

### 场景 D：改 CodeIsland

1. 进入：
   - `vendor/code-island`
2. 改代码
3. 回根目录重新 build / verify
4. 提交 `vendor/code-island`

---

## 16. 之前踩过的坑，后面尽量别再踩

这些都是真实踩过的坑，不是理论提醒。

### 坑 1：进错工作区

以前最大的问题就是：

- 旧目录和新目录都长得像能工作

现在记住：

**只在 `/Users/jachi/Desktop/letta-workspace` 正常工作。**

### 坑 2：把缓存当源码

这些都不是正式源码：

- `runtime/`
- `releases/`
- `dist/`
- `build-resources/`
- `node_modules/`

不要把功能直接改在这里。

### 坑 3：改错 repo

如果问题是底层 provider、CLI、Python server、CodeIsland，本质上不是一个 repo 的事。

所以先判断问题属于哪一层，再改。

### 坑 4：打包通过 ≠ 真能运行

以前遇到过：

- 包能打出来
- 但运行时缺依赖
- 或者 PATH 不对
- 或者用了外部环境

所以：

**一定要跑 `./scripts/verify-release.sh`。**

### 坑 5：Finder 启动时没有 shell PATH

以前出现过：

- `spawn node ENOENT`

原因是 Finder 启动 app 时，没有你终端里的 PATH。

所以后面不要默认依赖系统 shell 环境，优先用 app 自己的 runtime。

### 坑 6：打包后的路径和开发时路径不一样

以前出现过：

- `app.asar`
- `app.asar.unpacked`
- CLI 路径解析错误

所以任何涉及打包路径的改动，都必须重新做安装态验证。

### 坑 7：compatible provider 的链路很绕

`Anthropic-compatible` / `OpenAI-compatible` 不是简单改个 URL 就行。  
这里已经踩过很多坑，所以不要轻易重写这条链。

如果要改 compatible provider，先优先看：

- `vendor/letta-code`
- `app/letta-desktop/src/electron/libs/provider-bootstrap.ts`

### 坑 8：不要轻易动远程主分支历史

这次已经把 remote 策略整理好了。  
以后如果不是明确知道自己在做什么，不要随便 force push。

### 坑 9：mac 本地签名可能卡在 timestamp service

这次真实遇到过：

- `electron-builder` 编译都通过了
- 但 `codesign` 在签内置 Python runtime 时失败
- 报错是 `The timestamp service is not available.`

处理方式：

- 本地开发打包时，在
  `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/electron-builder.json`
  的 `mac` 配置里显式设：
  - `"timestamp": "none"`

这不是业务代码问题，是 Apple 时间戳服务不可用时的本地打包稳定性问题。  
如果以后又出现同类报错，先看签名配置，不要先怀疑 Letta 本身逻辑。

### 坑 10：bundled Python.framework 不能带外部 symlink

这次还真实遇到过：

- `codesign` 会先因为 framework 结构不完整失败：
  - `bundle format unrecognized, invalid, or unsuitable`
- 修到一半后，最后 `codesign --verify --deep --strict` 又会失败：
  - `invalid destination for symbolic link in bundle`

根因是：

- Homebrew 里的 `Python.framework` 不是一个可直接分发的完整独立 bundle
- 直接拷进 app 后，里面会残留指向 `/opt/homebrew/...` 的绝对 symlink
- 这些链接在开发机上可能“看起来能用”，但打包校验一定会炸

这次的修复已经落在：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/scripts/build-letta-server.mjs`

要点是：

- 补齐 framework 根目录的标准链接：
  - `Versions/Current`
  - `Python`
  - `Headers`
  - `Resources`
- 把 `Headers` 改成 bundle 内部的相对链接
- 把 `libpython3.11.dylib` / `libpython3.11.a` 这些库链接也改成 bundle 内部相对路径

以后如果改了 bundled Python 或 LettaServer 打包逻辑，必须重新检查：

- app 内部不能有指向 `/opt/homebrew/...` 的 symlink
- 不能有指向 bundle 外部的绝对路径
- 跑完 `./scripts/build-release.sh` 后，必须再跑 `./scripts/verify-release.sh`

### 坑 11：build 成功后，还要看 release smoke 是否真能对话

这次最终不是只看 `.dmg` / `.zip` 出来就算过。

最终验收链路应该是：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/build-release.sh
./scripts/verify-release.sh
```

`verify-release.sh` 现在不只是检查文件存在，它还会做：

- bundled Letta server verify
- bundled Letta server smoke
- app bundle health check
- provider 注册
- 一轮真实 chat smoke

只有这条链完整通过，才算这次 release 真正可交付。

---

## 17. 如果你完全不知道从哪开始

按这个最傻瓜顺序来：

1. 打开：
   - `/Users/jachi/Desktop/letta-workspace/README.md`
2. 跑：
   ```bash
   cd /Users/jachi/Desktop/letta-workspace
   ./scripts/doctor.sh
   ./scripts/repo-status.sh
   ```
3. 如果是普通产品需求，先去：
   - `app/letta-desktop`
4. 改完后跑：
   ```bash
   ./scripts/verify-release.sh
   ```
5. 再 `git status`、`git add`、`git commit`、`git push`

如果你还是不确定，就默认：

**先从 `app/letta-desktop` 查起，而不是先钻进 `vendor/`。**

---

## 18. 最后一句最重要的话

这个项目现在已经整理成：

- 一个主工作区
- 一个归档区
- 一个主产品 repo
- 四个职责明确的 vendor repos
- 一套固定的构建和验收脚本
- 一套明确的 Git / GitHub 策略

以后维护时，最重要的不是“记住所有历史”，而是：

**始终从正确的工作区开始，先判断问题属于哪一层，再改对应的 repo，改完一定跑验收。**

如果一直遵守这三件事，这个项目后面就不会再回到以前那种混乱状态。

---

## 19. Observability v1：怎么复制诊断信息

现在桌面端已经有一套轻量诊断链路：

- 关键链路会生成 `traceId`
- 主进程会把结构化日志聚合成 compact diagnostics summary
- 当 UI 里出现可诊断的 warning / error banner 时，会显示 `Copy diagnostics`

当前这颗按钮主要会出现在：

- CodeIsland 启动告警
- session / runner 失败产生的全局错误提示

复制出来的诊断文本会包含：

- `summary`
- `traceId`
- `turnId`
- `sessionId`
- `errorCode`
- `lastSuccessfulDecisionId`
- `firstFailedDecisionId`
- `suggestedAction`
- 简短步骤列表：`component | decisionId | status | message`

测试时如果你看到异常，不需要再手工长篇描述。
优先点一次 `Copy diagnostics`，把那段文本直接发给模型，就能明显减少排障时重新全仓扫描的成本。

### 当前限制

这套 `v1` 仍然有边界：

- diagnostics 目前是内存态，应用重启后不会保留
- 现在只接入了最关键的两个 banner，还没有单独 diagnostics 页面
- 测试输出里仍会看到结构化日志打印，这不影响功能，但后面可以继续收敛
