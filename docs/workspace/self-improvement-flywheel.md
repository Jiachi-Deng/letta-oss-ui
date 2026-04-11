# Self-Improvement Flywheel v1

这是 workspace 根目录 `docs/self-improvement-flywheel.md` 的 repo-managed 副本。

核心目标：

- 让生产事故自动沉淀成 `incident pack`
- 让 AI 基于 incident pack 生成 `eval case`
- 让 case 进入发布前回归集

当前主文档：

- [workspace self-improvement flywheel](/Users/jachi/Desktop/letta-workspace/docs/self-improvement-flywheel.md)

对 app repo 来说，这份规范最相关的落点是：

- diagnostics / incident archive
- desktop runner
- packaged runner
- visual runner
- release gate

当前已经可用的命令：

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run evals:incident-packs
bun run evals:generate-cases
bun run evals:packaged
bun run evals:desktop-renderer
```
