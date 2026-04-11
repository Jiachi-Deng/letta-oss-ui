# Packaging Playbook

镜像副本，保持和 workspace 根文档一致。

主文档：

- [workspace packaging playbook](/Users/jachi/Desktop/letta-workspace/docs/packaging-playbook.md)

打包、首装、DMG、ZIP、`/Applications` 相关问题，先读上面的主文档，再继续改代码。

## LettaServer slimming rules

`LettaServer` 的体积现在不是靠“手工删掉某次打包产物”来维持，而是靠构建脚本里的正式规则：

- [build-letta-server.mjs](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/scripts/build-letta-server.mjs)
- 默认 profile: `telegram-lite`

关键点：

- 所有默认 `dist:*` 发布脚本都会先重新运行 `build:letta-server`
- `build:letta-server` 会重新生成 `build-resources/LettaServer`
- 所以如果你只是手工删某个 `.app` 或某个 staging 目录，下次重打包还是会回到脚本定义的内容

当前默认发布路径：

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run build:letta-server:telegram-lite
bun run dist:mac-arm64:telegram-lite
bun run release:check:telegram-lite -- --app /absolute/path/to/Letta.app
```

其它默认发布脚本现在也走同一条瘦身路径：

```bash
bun run dist:mac-x64
bun run dist:win
bun run dist:linux
```

如果要永久裁掉某些 Python 内容，改脚本规则，不要改产物副本。
