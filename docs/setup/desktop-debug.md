# 桌面端调试指南

面向：Samuel。回答"我怎么调这个桌面程序"。

---

## 0. 先搞清楚你现在跑的是哪一版

**这是最要紧的一条**：`dist/` 里那个 exe 是**打包时的快照**，
源代码改了它不会变。本轮 S4/S5 新增的 `sync.json`、两个云按钮的新文案，
**在旧 exe 里全都不存在**。

自证：看一眼数据目录里有没有 `sync.json`。

```
%APPDATA%\象限\
├── plan.json           ← 你的全部数据（事件、目标、周计划）
├── plan.backup.json    ← 上一次写入前的自动备份
├── sync.json           ← 本轮新增：同步元信息。现在还没有 = 跑的是旧构建
└── reviews\            ← 复盘的 md 导出
```

现在 `sync.json` 不存在，说明你运行的是本轮之前的构建。

---

## 1. 改代码时的正确姿势：`npm run dev`

```bash
cd "D:/Samuel/Vibe Coding"
npm run dev
```

这是 `electron-vite dev`，起的是**源码模式**：

- 渲染进程（React 界面）改完即时热更新，不用重启
- 主进程（`src/main/*.ts`）改完会自动重启应用
- 终端里直接看到主进程的 `console.log` 和报错栈

**日常调界面就用这个，别用打包版。** 一轮"改 → 打包 → 双击 exe"
要几分钟，而这个只要一秒。

---

## 2. 打开 DevTools（打包版打不开，这是设计使然）

`src/main/index.ts:34` 有一行：

```ts
Menu.setApplicationMenu(null)
```

它把整个菜单栏删掉了。**Electron 的 `Ctrl+Shift+I` 来自默认菜单**，
菜单没了，快捷键也就没了——所以打包版的 exe 里你按不出 DevTools。

两个办法：

**办法 A（推荐，不改代码）**：用 `npm run dev`。开发模式下想看什么看什么。

**办法 B（想在打包版里也能调）**：在 `createWindow()` 里加一行，

```ts
createWindow() {
  const win = new BrowserWindow({ /* ... */ })
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' })
  // ...
}
```

`app.isPackaged` 保证这条只在开发模式生效，正式 exe 不会自动弹窗。
需要的话我可以直接加上。

---

## 3. 排查用的几个抓手

### 看 IPC 到底注册上没有

打开 DevTools → Console，直接调：

```js
await window.quadrantApi.loadSyncMeta()   // 应返回 { deviceId, dirty, cloudRevision, ... }
Object.keys(window.quadrantApi)           // 看有哪些方法
```

如果 `loadSyncMeta` 是 `undefined`，说明主进程或 preload 是旧的
（对，就是"exe 没重打包"那个问题）。

### 看渲染进程报错

DevTools → Console。桌面端和网页端**共用同一套渲染层代码**，
所以网页端 Console 里能重现的问题，这里也一样。

### 读数据文件

`plan.json` 就是 `AppData` 的原文。想看当前状态、或者想手工验证迁移是否
正常，直接打开它最快。改之前先复制一份——应用运行时会覆盖它。

### 想看网络请求

同步走 Supabase 的 fetch。DevTools → Network 里筛 `supabase.co`。
「上传到云端」应该是一条 `POST /rest/v1/user_data`，
「从云端恢复」是一条 `GET`。

---

## 4. 大多数界面问题根本不用开 Electron

桌面端和网页端**共用** `src/renderer/**`，只有"数据存哪儿"不同
（网页端 localStorage、桌面端走 IPC）。所以：

```bash
npm run dev:web          # 起网页端开发服务器
node scripts/ui-probe.mjs --mode mouse --page review --target .review-slider-row --from 0.5,0.5 --to 0.9,0.5
node scripts/sync-probe.mjs
```

`scripts/sync-probe.mjs` 里的"桌面壳模拟"会往页面注入一个假的
`window.quadrantApi` 和假登录会话，因此**能在真浏览器里把所有桌面端分支
跑一遍**，包括这一轮新加的按钮、确认框、间距。它比开 Electron 快得多，
而且是可重复执行的断言，不是"我看着没问题"。

真正的桌面专属风险只有三类，这三类才必须开 Electron 验：

1. IPC 通道（主进程 ↔ preload ↔ 渲染进程）
2. 文件落盘（`plan.json` / `sync.json` 的写入与 `before-quit` 等待）
3. 打包产物本身（asar 里文件齐不齐、exe 能不能起）

---

## 5. 重新打包

```bash
npm run package     # = electron-vite build && electron-builder --win portable
```

产物：`dist/象限-1.0.0.exe`（绿色便携版，不写注册表）。
`%APPDATA%\象限\` 下的数据不受影响，重打包不会动你的数据。

打完包记得做一次冒烟：起 exe → 侧栏应出现「上传到云端 / 从云端恢复」
→ 点一下看确认框出不出来。

---

## 6. 本轮没验到的部分

- **我没法在这个环境里跑 Electron**（无显示器）。`sync.json` 的 IPC 通道、
  `before-quit` 的落盘等待，只做了编译与代码审阅，**没有真机验证**。
  这两条正是上面第 4 节说的"必须开 Electron"的那类。
- 建议你按第 5 节重打包后，重点确认：点「上传到云端」→ 看
  `%APPDATA%\象限\sync.json` 有没有生成、内容对不对。
