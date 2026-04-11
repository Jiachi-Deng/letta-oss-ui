# Migration Status

当前迁移已经不再只是“工作区换目录”。

现在已经进入：

- workspace 已迁完
- Resident Core 方向已建立
- vendored lettabot 已接入
- Telegram 和 desktop 已完成第一轮稳定化
- channels runtime hot reload 已改成 rollback-safe 的两阶段切换，runtime config 现在只通过 `channels` 容器暴露渠道配置
- channels runtime stale backend invalidation 现在受 runtime generation guard 保护，旧 host stop 不会误清当前 bot session
- desktop 端旧的 `allowedTools` session.start 约定已移除，等待真实 policy 模型
- Telegram / bot traces 现在会进入共享的 Resident Core projection/control-plane 路径

接下来更重要的是：

1. 继续压低 `vendor/lettabot` patch 面
2. 把 channel registry / onboarding 继续整理到多渠道模型
3. 为后续 Discord / Web 做准备
