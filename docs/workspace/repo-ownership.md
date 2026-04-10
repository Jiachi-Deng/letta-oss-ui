# Repo Ownership

## `app/letta-desktop`

负责：

- Electron
- React UI
- diagnostics
- Resident Core wiring
- startup orchestration
- packaged app assembly
- Telegram 设置保存和热重载接线

## Other repos

- `vendor/letta-monorepo`
  - Python Letta server
- `vendor/letta-code`
  - runtime / tools / skills / MCP
- `vendor/letta-code-sdk`
  - SDK transport / glue
- `vendor/lettabot`
  - Telegram / 其他 IM 渠道
- `vendor/code-island`
  - CodeIsland app

## Rule of thumb

1. 产品行为 / 桌面行为 / 设置行为：先看 `app/letta-desktop`
2. runtime / tool / skill / MCP：看 `vendor/letta-code`
3. Python server / provider backend：看 `vendor/letta-monorepo`
4. 渠道层：看 `vendor/lettabot`
5. companion app：看 `vendor/code-island`
