# CLAUDE.md

给在这个仓库里工作的 Claude 看的项目说明,目的是改动/升级这个项目本身(不是"如何用这个 SDK 做模型"——那部分见 [sdk/README.md](sdk/README.md) 和 [.claude/skills/blockbench-headless/SKILL.md](.claude/skills/blockbench-headless/SKILL.md))。

## 这是什么

`blockbench-headless` 是 [Blockbench](https://www.blockbench.net)(Minecraft 低多边形模型编辑器)的无 GUI 化改造,同一份 `js/` 引擎源码现在编译出三种产物,外加两层新增的对外接口:

```
js/              原版 Blockbench 引擎源码(TS/JS),按 build.js 的 target 编译成下面三种产物
  ├─ electron 目标 → dist/bundle.js   桌面 Electron app(原版功能,主入口 electron/main.js)
  ├─ web 目标      → dist/bundle.js   浏览器版(npm run serve)
  └─ headless 目标 → dist/headless.js 无 GUI 引擎,供 sdk/ 加载,这是这次改造新增的核心产物

sdk/             Node.js 包装层,纯 ESM,不需要编译。加载 dist/headless.js 暴露 createSession/
                 renderSession/WorkerPool 等 API。通过根 package.json 的 "exports" 对外发布。

mcp/             独立的 MCP server(server.mjs),把 SDK 包装成 Claude/Cowork 可调用的工具
                 (run_script / check_setup / build_engine / list_files / read_file)。
                 有自己的 package.json,但**没有**配 npm workspaces —— 见下面"依赖管理"。

types/           可独立发布到 npm 的纯类型包(npm run publish-types),与上面三层无关。

examples/, spike/  验证/示例脚本,改动后用来抽测(见"改动后如何验证")。
```

## 核心机制:一份源码,三个 target

`build.js`(esbuild)靠**条件导入插件**让同一个入口适配三种环境,而不是维护三份源码。改 `js/` 下任何文件前,先搞清楚它会不会被这套机制摆渡:

- `import '.../native_apis'` → 按 target 重写成 `native_apis_headless.ts` / `native_apis.ts`(electron)/ `native_apis_web.ts`
- `import '.../desktop'` → 重写成 `headless.js` / `desktop.js` / `web.js`
- 入口文件本身也不同:headless 用 `js/main_headless.ts`,其他用 `js/main.js`

`define` 注入了 `isHeadless` / `isApp` 全局常量,源码里大量 `if (isHeadless) ...` 分支就是靠这个做 dead-code elimination(看 [build.js](build.js) 里的 `conditionalImportPlugin`)。

**`dist/` 整个目录被 gitignore 了**,不会随仓库分发,每次都要本地构建(见下面命令)。

## 依赖管理约定(踩过坑,务必遵守)

根 [package.json](package.json) 的 `dependencies` 应该且只应该包含:

1. **esbuild 标记为 `external` 的包**——目前是 `gl`、`@napi-rs/canvas`、`jsdom`、`pngjs`(见 build.js 的 `external` 数组,headless target 专属)。这些不会被打包进 `dist/headless.js`,产物运行时直接 `require()`,必须在消费者的 `node_modules` 里真实存在。
2. **被 `sdk/*.mjs`、`mcp/*.mjs`、`scripts/*.mjs`/`.js` 直接 `import`/`require` 的包**(这些文件不经过 esbuild,原样运行)——比如 `@modelcontextprotocol/sdk`(被 `mcp/server.mjs` 用,根目录的 `npm run mcp` 脚本直接跑这个文件,而 `mcp/` 没装过自己的 node_modules,根 package.json 必须也声明一份)。

除此之外,任何只在 `js/` 源码里被引用、最终被 esbuild **打包内联**进 `dist/*.js` 的包(`three`、`vue`、`jquery`、`molangjs`、`jszip`、`gifenc`、`tinycolor2`、`sortablejs` 等)都应该放 `devDependencies`——产物造出来之后,这些包不需要单独存在于消费者的 node_modules。

新加一个 npm 包之前,先问自己两件事再决定放哪边:
- 这段代码会被 esbuild 打包吗(在 `js/` 里,且没在 `external` 列表)?→ 打包内联,放 `devDependencies`。
- 还是被 `sdk/`、`mcp/`、`scripts/` 下的文件直接运行时 import,或者是 `external` 列表里的原生模块?→ 真实运行时依赖,放 `dependencies`。

`mcp/package.json` 是独立的一份(给 `mcp/` 单独安装用的保障),根 package.json 不会自动读取它——两边都要声明 `mcp/server.mjs` 用到的包。`types/package.json` 也是完全独立的发布单元,不受这条约定影响。

这个项目从不 `npm publish` 根包(只有 `types/` 会发布),平时只靠 `npm link` 或直接 clone 整仓库使用,所以分类错了不会立刻报错——但只要有人做 production-only 安装(`--omit=dev`)或者 `mcp/` 被单独抽出来部署,分类错误就会变成真实的 `Cannot find module`。改完依赖记得跑一遍下面"改动后如何验证"。

## 常用命令

```bash
npm run build-headless     # 编译 dist/headless.js —— 改了 js/ 下任何文件后,SDK/MCP 要看到新代码必须先跑这个
npm run build-web          # 编译 web 版 dist/bundle.js
npm run build-electron     # 编译 electron 版
npm run dev                # 启动 electron 桌面调试(热重载)
npm run serve              # 本地跑 web 版,http://localhost:3000
npm run mcp                # 启动 MCP server(stdio)
npm run mcp:http           # 启动 MCP server(HTTP/SSE,端口 BB_MCP_PORT,默认 7821)
npm run install-skill      # 把 .claude/skills/blockbench-headless/SKILL.md 装到 ~/.claude/skills/
npm run generate-types     # 生成 sdk/types,写到 types/generated
```

`sdk/` 本身是纯 ESM,不需要编译;只有改了 `js/` 才需要重新 `build-headless`。

## 改动后如何验证

1. `npm run build-headless` —— 确认 esbuild 不报错,`dist/headless.js` 生成成功。
2. SDK 烟雾测试(验证引擎+渲染链路没坏):
   ```bash
   node --input-type=module -e "
   import { writeFileSync } from 'node:fs';
   import { createSession, renderSession } from './sdk/index.mjs';
   const s = createSession('java_block', { name: 'block' });
   s.setResolution(16, 16);
   const cube = s.addCube({ name: 'block', from: [0,0,0], to: [16,16,16] });
   const tex = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#3a7d3a' });
   s.applyTexture(cube, tex);
   writeFileSync('/tmp/cb-smoke.png', renderSession(s, { angle: 'isometric' }));
   console.log('OK');
   "
   ```
3. 更全面的回归脚本(已有,直接跑):`node examples/showcase.mjs`、`node spike/sdk-test/render.mjs`、`node spike/sdk-test/sessions.mjs`、`node spike/sdk-test/pool.mjs`。
4. 改了依赖声明(package.json)之后:`npm install` → `git diff package.json package-lock.json` 确认改动范围符合预期、没有意外的已有包版本变化 → `npm ls --all` 确认没有非 OPTIONAL 的 `UNMET`/`invalid`/`extraneous`。
5. 改了 `mcp/` 相关代码:`BB_MCP_PORT=18421 node ./mcp/server.mjs` 起一下,确认能正常监听端口而不是立刻崩溃退出(stdio 模式下没有客户端连接时进程会很快自己退出,这是正常行为,不是 bug)。

构建产物日志里夹杂大量 `Vue warn`/`development mode`/`Downgrading settings to support WebGL 1` 之类的输出,都是无害噪音。

## 已知的文档/路径不一致(尚未处理)

`.claude/skills/blockbench-headless/SKILL.md` 和 `.claude/settings.json` 里的 MCP server 路径硬编码成了 `/Users/jokerben/Documents/WorkSpace/blockbench-nogui`,跟当前这份 checkout 的实际路径(`/Users/jefferey/work_space/tools/blockbench-nogui`)不一致——大概是在另一台机器/账号上生成的。如果要改这两个文件,记得这条路径需要按实际环境调整,不要照抄。
