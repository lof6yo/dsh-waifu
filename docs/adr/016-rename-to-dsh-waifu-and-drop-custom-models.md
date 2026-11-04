# ADR-016：插件更名为 dsh-waifu，并移除自定义模型支持

- 状态：Accepted
- 日期：2026-11-05
- 关联：supersede ADR-009（自定义模型动画映射）、ADR-010（本地模型 Host 路由）

## 背景

项目从 dsh-live2d-pets 分叉后，定位收敛为「只服务内置『简』模型、内置事件绑定与用户自定义 touchbox 部位」的桌宠插件。继续保留「自定义模型导入/选择」与「本地模型路径路由」会带来三处负担：

1. 设置页需要模型选择/导入 UI，与「专注一个模型」的产品方向冲突；
2. Host 需要维护 custom-models.jsonc、本地路径安全路由、动画映射合并等额外代码与测试；
3. 插件仍以 dsh-live2d-pets 命名，与 fork 后的产品名不一致。

## 决策

1. **更名**：包名/插件 id/bundle patch 行 id 统一为 `dsh-waifu`；Client/SSR 模块 id 由 tsdown `clientBundle('dsh-waifu', …)` 生成；插件导出名改为 `dsh-waifu`。
2. **运行时路径与 API 前缀**改为 waifu 品牌：API `/api/dsh-waifu/*`、素材 `/waifu-assets/*`、插件私有目录 `$DSH_HOME/waifu/`（settings.jsonc / touch-parts.jsonc / client.log）、显示位置文件 `$DSH_HOME/waifu.json`。
3. **移除自定义模型支持**：删除 `src/custom-models.ts`、`src/local-models.ts` 及测试；删除 `/models`、`/custom-models`、`/pet-local-models` 路由与模型选择/导入 UI；`resolveModelUrl` 只解析内置 preset（失效 id 回退默认内置模型）；`resolveMotionMap` 只读取内置 preset 的 animationMap + 用户事件绑定覆盖。
4. 文档同步：README/AGENTS/intent/spec/CHANGELOG 更新为新名称与「仅内置简、无模型导入」；spec/intent 文件更名为 `dsh-waifu-v01.md` / `dsh-waifu.md`。

## 后果

- 插件以新名称 dsh-waifu 安装/分发（npm 包名与 DSH bundle 行一致），设置页只保留显示/事件绑定/触摸部位/开发者选项。
- 旧版 `dsh-live2d-pets` 的 profile 安装与运行时数据（`$DSH_HOME/live2d-pet/`、`live2d-pet.json`）不再读取：本机开发环境已人工清理；对外发布视为破坏性变更，不提供自动迁移。
- 后续如需重新支持自定义模型，按新架构重新引入（模型注册 + 动画映射 + 安全本地路由），不要恢复旧实现。
