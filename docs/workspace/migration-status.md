# Migration Status

当前迁移已经不再只是“工作区换目录”。

现在已经进入：

- workspace 已迁完
- Resident Core 方向已建立
- vendored lettabot 已接入
- Telegram 和 desktop 已完成第一轮稳定化
- Telegram runtime hot reload 已改成 rollback-safe 的两阶段切换
- desktop 端旧的 `allowedTools` session.start 约定已移除，等待真实 policy 模型
- Telegram / bot traces 现在会进入共享的 Resident Core projection/control-plane 路径

接下来更重要的是：

1. 继续压低 `vendor/lettabot` patch 面
2. 把 Telegram-specific 接线继续抽象成多渠道模型
3. 为后续 Discord / Web 做准备
