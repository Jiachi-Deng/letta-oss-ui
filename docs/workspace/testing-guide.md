# Letta Desktop Testing Guide

## 1. 这份文档是给谁的

这份文档不是写给资深工程师的。

它是写给：

- 新加入项目的测试同学
- 临时接手桌面端测试的人
- 不熟悉 Letta / Electron / agent 架构的人
- 需要把问题快速交还给模型或工程师的人

目标只有一个：

**让你不用先读懂全部代码，也能把问题测出来、定位到链路节点、把有效信息交回来。**

---

## 2. 先理解 3 个基本原则

### 2.1 不要先讲很长的 bug 故事

如果界面上已经出现 `Copy diagnostics`，优先先点它。

先拿到结构化诊断，再补截图和主观描述。

### 2.2 不同测试路径不能混在一起

这个项目至少有 4 种常见测试路径：

- `Bundle Smoke`
- `DMG 首装`
- `ZIP 首装`
- `新 macOS 用户 / 新虚拟机首装`

不要用 `dist/mac-arm64/Letta.app` 的结果，去推断 `.dmg/.zip` 的真实首装体验。

### 2.3 出问题时，要优先确认“卡在哪个节点”

你不用先猜代码。

你先回答这 4 个问题：

1. 你用的是哪条测试路径
2. 你卡在哪一步
3. 界面有没有 `Copy diagnostics`
4. 有的话，复制出来的 `traceId / errorCode / firstFailedDecisionId` 是什么

---

## 3. 测试前先知道这些词是什么意思

### 3.1 `traceId`

一次完整问题链路的编号。

比如一次“启动 session -> 注册 provider -> 发消息 -> 等回复”的过程，会有一个 `traceId`。

### 3.2 `decisionId`

链路中的关键判断点编号。

可以把它理解成“第几个小朋友接到花”。

如果某个节点失败了，系统会尽量告诉你失败发生在哪个 `decisionId`。

### 3.3 `errorCode`

稳定错误码。

它不是自然语言描述，而是给：

- 模型
- 工程师
- 测试

统一使用的短标识。

### 3.4 `Diagnostics`

这是桌面端里的独立诊断页面。

它可以用来看：

- 最近 traces
- 某一条 trace 的 summary
- steps
- suggested action

---

## 4. 你什么时候该用什么测试

### 4.1 `Bundle Smoke`

用于验证 app bundle 本体是否能跑。

输入物：

- `app/letta-desktop/dist/mac-arm64/Letta.app`

适合查：

- app 本体是否能启动
- bundled Letta server 是否完整
- CodeIsland 资源是否完整
- 聊天功能本体是否正常

不适合拿来证明：

- `.dmg/.zip` 首次安装没问题
- Finder 拖拽安装体验没问题
- Gatekeeper / quarantine 没问题

### 4.2 `DMG 首装`

用于模拟普通用户收到 `.dmg` 后的真实安装体验。

步骤：

1. 运行 `./scripts/retest-first-install.sh`
2. 打开 `releases/Letta-*.dmg`
3. 在 Finder 里把 `Letta.app` 拖到 `Applications`
4. 弹出 DMG
5. 从 `Applications` 打开

### 4.3 `ZIP 首装`

用于模拟普通用户收到 `.zip` 后的真实安装体验。

步骤：

1. 运行 `./scripts/retest-first-install.sh`
2. 打开 `releases/Letta-*.zip`
3. 解压
4. 把 `Letta.app` 拖到 `Applications`
5. 从 `Applications` 打开

### 4.4 `新 macOS 用户 / 新虚拟机`

这是最严格的首装测试。

它最适合查：

- 新机器/新用户下的首次授权问题
- Gatekeeper / quarantine
- 嵌套 app 首次启动
- 机器环境差异
- 系统版本差异

---

## 5. 标准测试流程

### 5.1 同机首装复测

先执行：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/retest-first-install.sh
```

通过标准：

- `/Applications/Letta.app` 不存在
- Letta / CodeIsland 用户态残留不存在
- 没有 Letta / CodeIsland / `letta.js` 相关进程
- 最新 `.dmg/.zip` 已同步到 `releases/`

### 5.2 首装后最少要验什么

至少验这几项：

1. 能打开主窗口
2. 能完成配置保存
3. 第一条消息有回复
4. 连续 3 条消息都正常
5. CodeIsland 是否正常启动，或至少有明确诊断
6. 退出再打开后，配置和会话是否还正常

---

## 6. 出问题时怎么做

### 6.1 如果界面出现 `Copy diagnostics`

按这个顺序：

1. 点击 `Copy diagnostics`
2. 保存复制出来的文本
3. 再截图
4. 再补“我刚才做了什么”

### 6.1.1 什么时候改点 `Copy full trace`

如果你已经进了 `Diagnostics` 页面，而且遇到的是下面这些情况，不要只复制 compact summary，改点 `Copy full trace`：

- 同一条 trace 里有很多 steps
- 你怀疑是多个边界叠在一起出了问题
- 你怀疑是 CLI / CodeIsland / server 这种子进程链路问题
- 你需要把 step data 一起发给模型

简单规则：

- 日常问题：先 `Copy diagnostics`
- 复杂链路问题：再 `Copy full trace`

### 6.2 如果没有 `Copy diagnostics`

去左侧栏 `Diagnostics` 页面：

1. 找最近的 trace
2. 看 `summary`
3. 看 `errorCode`
4. 看 `firstFailedDecisionId`
5. 必要时点 `Copy diagnostics`

### 6.3 什么时候复制 `Copy full trace`

`Copy full trace` 不是日常第一选择，它更适合这些情况：

1. 一个 trace 里出现了多步失败，单看 compact summary 不够
2. 你怀疑问题和 `traceId / sessionId` 对应的整条链路有关，而不是单点失败
3. 失败牵涉到子进程、启动、stream、permission 或 metadata 组合
4. 你需要把 step data 一起发给模型，让它复盘完整链路

简单记法：

- **先看 `Copy diagnostics`**
- **复杂链路或多步问题，再看 `Copy full trace`**

### 6.4 你提交问题时，至少带这些信息

- 测试路径：`Bundle Smoke / DMG / ZIP / 新用户 / 虚拟机`
- 安装包文件名
- macOS 版本
- 问题发生在哪一步
- `traceId`
- `errorCode`
- `firstFailedDecisionId`
- 截图

---

## 7. v1 / v2 诊断能力怎么用

### 7.1 v1 已完成

- 关键链路会生成 `traceId`
- 关键失败点会有 `decisionId`
- 关键失败会带 `errorCode`
- warning / error banner 可 `Copy diagnostics`
- diagnostics 会持久化到本机 app 数据目录
- 重启后还能在 `Diagnostics` 页面看到最近 traces

### 7.2 v2 正在继续扩大覆盖

当前 v2 的目标是继续把更多主链路纳入 trace，包括：

- stop / delete / history
- permission request / response
- stream 异常边界
- LettaServer 启动、健康检查、恢复
- CLI / CodeIsland 子进程输出

如果你看到某个失败现象还没有明确 `errorCode`，不一定表示系统完全坏了，可能只是那条链路还没被 observability 覆盖完整。

---

## 8. 故障字典

这份字典的作用不是替代源码，而是帮助你快速判断“这更像哪一类问题”。

### `E_PROVIDER_CONNECT_FAILED`

含义：

- provider 注册或兼容 provider bootstrap 失败

常见现象：

- 配置保存后卡住
- 首次进入 session 失败
- 界面可能显示连接相关报错

先看什么：

- base URL
- API key
- provider 类型
- diagnostics 里的 bootstrap 相关 steps

### `E_CODEISLAND_OS_UNSUPPORTED`

含义：

- 当前 macOS 版本低于 CodeIsland 所需最低版本

常见现象：

- Letta 本体可聊天
- CodeIsland 起不来
- UI 会提示当前系统版本不支持

先看什么：

- `sw_vers`
- diagnostics summary

### `E_CODEISLAND_LAUNCH_BLOCKED`

含义：

- CodeIsland 首次启动很可能被 macOS 安全策略拦住

常见现象：

- Letta 正常
- CodeIsland 没有真正起来
- 新用户 / 虚拟机更容易出现

先做什么：

1. 去 `System Settings > Privacy & Security`
2. 看是否有允许启动提示
3. 必要时手工打开嵌套的 `CodeIsland.app`

### `E_SESSION_CONVERSATION_ID_MISSING`

含义：

- session 初始化后没有拿到应有的 conversation id

常见现象：

- session 启动后 UI 卡住
- 后续消息链路无法正确进入

先看什么：

- session init 相关 steps
- `runner` 边界的 diagnostics

### `E_ASSISTANT_CONTENT_PARSE_FAILED`

含义：

- assistant 返回内容结构解析失败

常见现象：

- 后端看起来成功了
- UI 没显示回复

先看什么：

- assistant message payload
- diagnostics steps 中的 parsing / stream result 边界

### `E_LETTA_CLI_SPAWN_FAILED`

含义：

- `letta-code` CLI 根本没有成功拉起来

常见现象：

- provider 注册走不通
- 兼容 provider 配置失败
- 很早就在 bootstrap 阶段报错

先看什么：

- `CLI_CONNECT_001` 到 `CLI_CONNECT_006`
- CLI 路径是否正确
- Node / Electron runtime 环境

### `E_LETTA_CLI_EXIT_NON_ZERO`

含义：

- `letta-code` CLI 启动了，但以非零退出码失败

常见现象：

- `letta connect` 失败
- 参数兼容性问题
- provider 配置输入不被接受

先看什么：

- `stderrPreview`
- `stdoutPreview`
- `CLI_CONNECT_005`

### `E_CODEISLAND_LAUNCH_COMMAND_FAILED`

含义：

- Letta 调 `open CodeIsland.app` 这一步就失败了

常见现象：

- CodeIsland 还没进入验证阶段就失败
- diagnostics 里能看到 launch command 失败

先看什么：

- `CI_LAUNCH_001 / 002 / 003`
- `open` 命令返回值
- `stderrPreview`

### `E_CODEISLAND_MONITOR_RESTART_FAILED`

含义：

- CodeIsland monitor 发现 companion 没在跑，并尝试重启，但重启失败

常见现象：

- 一开始可能起过
- 后面被 monitor 发现掉了
- Letta 尝试拉起但没有成功

先看什么：

- `CI_MONITOR_001 / 002 / 003 / 004`
- 最近一次 launch command 结果
- 是否存在系统级拦截或 quarantine

### `E_SERVER_START_FAILED`

含义：

- bundled Letta server 在启动前准备或启动过程中失败

常见现象：

- 首次进入聊天前就卡住
- provider bootstrap 走不下去
- 本地 Letta server 相关功能不可用

先看什么：

- `Diagnostics` 页面里 server resolve / server start 相关 steps
- bundled server runtime 路径是否存在
- Python runtime 是否完整

### `E_SERVER_HEALTHCHECK_TIMEOUT`

含义：

- bundled Letta server 已尝试启动，但在限定时间内没有通过健康检查

常见现象：

- app 打开了，但迟迟进不去可用状态
- 配置保存后卡住

先看什么：

- `SERVER_HEALTHCHECK_*` 相关 decision
- 是否是端口不可达
- 是否是 server 进程启动后未 ready

### `E_SERVER_EXITED_EARLY`

含义：

- bundled Letta server 子进程在 ready 之前就退出了

常见现象：

- 启动时很快失败
- healthcheck 一直过不了

先看什么：

- `SERVER_EXIT_001`
- startup trace 里的最后成功 decision
- bundled server init / spawn 步骤

### `E_SERVER_UNEXPECTED_EXIT`

含义：

- bundled Letta server 已经 ready 过，但后面又异常退出

常见现象：

- 一开始正常，后面突然对话失败
- diagnostics 显示 server exit after ready

先看什么：

- `SERVER_EXIT_002`
- ready 前后发生了什么动作
- 最近一次 server recovery / healthcheck 记录

---

## 9. 已知经验和坑

### 9.1 `dist` 能跑，不代表安装包没问题

这是最常见误判之一。

`dist/mac-arm64/Letta.app` 正常，只能说明 bundle 本体大致没坏。

它不能自动证明：

- `.dmg` 正常
- `.zip` 正常
- Finder 安装路径正常
- Gatekeeper 不会拦

### 9.2 同一台机器“清理后重测”不等于真正首装

这只是近似首装。

最严格的测试仍然是：

- 新 macOS 用户
- 新虚拟机

### 9.3 CodeIsland 问题不一定是 Letta 主体问题

很可能是：

- 系统版本不满足
- Gatekeeper
- 首次授权
- 嵌套 app 首启失败

不要看到“CodeIsland 没起”就先断言“聊天主流程坏了”。

### 9.4 先拿 diagnostics，再让模型排

这是工程效率问题，不是形式主义。

如果不先拿 `traceId / errorCode / decisionId`，模型通常只能全仓大扫描，慢而且贵。

### 9.5 子进程问题要优先看 preview，不要先猜源码

现在 diagnostics 里已经开始包含一些子进程边界信息，例如：

- CLI 的 `stdoutPreview / stderrPreview`
- CodeIsland launch command 的结果摘要

这时优先先看这些 preview。

因为这类问题很多不是“业务逻辑错了”，而是：

- 参数不兼容
- 系统命令失败
- 安全策略拦截
- 子进程自己异常退出

---

## 10. 新人上手的最短路径

如果你今天刚接手测试，照这个顺序做：

1. 读完本文件
2. 学会运行 `./scripts/retest-first-install.sh`
3. 先做一轮 `DMG 首装`
4. 出问题先点 `Copy diagnostics`
5. 再去 `Diagnostics` 页面看最近 trace
6. 按第 6 节格式提交问题

做到这一步，你已经能有效参与这个项目的测试了。
