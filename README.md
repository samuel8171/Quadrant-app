# 象限

面向大学生的时间管理桌面软件（Electron + React + TypeScript）。

## 功能

- 目标：长期/短期目标、子目标顺序/并列关系
- 四象限：可平移缩放的事件坐标系、事件管理
- 周计划：周视图总览（自适应、只读）、单日时间轴（上下滚动、整点吸附）、全局事件预设（8 色 + 四象限 + 时长自定义 ≤10 小时）、事件可选同步到四象限（不重叠、每象限上限 30）
- 周日复盘：占位（开发中）

## 开发

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

## 打包

```bash
npm run package
```

产物在 `dist/` 下，为便携单文件 exe。

## 数据

数据保存在 `%APPDATA%/象限/plan.json`，写入前自动备份为 `plan.backup.json`。

## MCP（预留）

后期将提供 MCP stdio 服务，使外部 Agent 可协作读写计划数据；工具清单见 `src/main/mcp/index.ts`，当前不随主程序启动。
