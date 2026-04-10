# Observability v1.5

这是 workspace 根目录 `docs/observability.md` 的 repo-managed 副本。

## 当前结论

这个项目已经有一套 desktop-centric observability v1 雏形，不是从零开始。

已有核心实现：

- [trace.ts](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/electron/libs/trace.ts)
- [diagnostics.ts](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/electron/libs/diagnostics.ts)
- [decision-ids.ts](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/shared/decision-ids.ts)
- [error-codes.ts](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/shared/error-codes.ts)
- [diagnostics-format.ts](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/shared/diagnostics-format.ts)
- [DiagnosticsPanel.tsx](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/src/ui/components/DiagnosticsPanel.tsx)

## 当前目标

把现有 desktop 侧这套定义成正式标准，并逐步覆盖：

- `vendor/lettabot`
- Telegram / Discord / Web
- Resident Core 边界

## 当前最关键的定义

- `traceId`
  - 一条完整链路编号
- `decisionId`
  - 关键判断点编号
- `errorCode`
  - 稳定错误码
- `suggestedAction`
  - 下一步最该查哪里

## 下一步优先级

1. 先给 `vendor/lettabot` 接同一套 `decisionId` / `errorCode`
2. 再把 Telegram 主链正式纳入统一 diagnostics
3. 再为 Discord / Web 铺复用路径

更完整说明看：

- `/Users/jachi/Desktop/letta-workspace/docs/observability.md`
- `/Users/jachi/Desktop/letta-workspace/docs/llm-triage-playbook.md`
