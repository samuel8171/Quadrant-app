# 四象限照片贴纸功能设计

- 日期：2026-09-16
- 基线：`main`（tag `v1.0.0`）
- 范围：四象限画布上的"照片贴纸"——可拼贴、可挂靠事件、与云同步兼容
- 状态：**待确认，未执行**
- 关联：`docs/superpowers/plans/2026-09-16-touch-gestures-and-sync-fixes.md`（本功能的导入/拖动/同步均依赖该方案的手势内核与同步一期）

---

## 1. 目标与范围

**目标**：在四象限平面直角坐标系上，允许把图片以"贴纸"形式钉在任意世界坐标上，支持拖动、缩放、旋转、删除；可挂靠在某个事件卡上，随事件一起移动；在桌面端与网页端（含手机）都能用；照片不进入同步主载荷。

| 包含 | 不包含 |
|---|---|
| 图片导入（文件选择 / 拖放 / 粘贴） | 视频、音频 |
| 贴纸的世界坐标定位、拖动、缩放、旋转 | 绘画/标注画笔 |
| 挂靠事件（跟随移动） | 多图合成/滤镜 |
| 缩略图与懒加载 | 图片裁切编辑器 |
| 桌面与网页的统一资源抽象 | 第三方图床 |
| 云端资源同步与垃圾回收 | 增量/差分上传 |

---

## 2. 现状与机会

| 观察 | 证据 | 影响 |
|---|---|---|
| 渲染层已是"世界坐标 + 一次 CSS transform" | `QuadrantPage.tsx:556-559` `.event-layer` 上 `translate(...) scale(...)` | **贴纸放进同一层即免费获得平移/缩放**，无需额外坐标换算 |
| 已有世界/屏幕坐标换算工具 | `quadrantMath.ts:32-46` `worldToScreenX/Y`、`screenToWorldX/Y` | 拖动逻辑可复用 |
| 已有避让算法 | `quadrantSync.ts:37-70` `findFreePosition` | 贴纸初始落点可复用同一套"行/列"排布 |
| 全仓无任何图片/Blob/IndexedDB 基础设施 | `grep` 无命中（`platformApi.ts` 仅用 `Blob` 导出文本） | 属全新能力，无历史包袱也无现成可复用件 |
| 主进程已有成熟的落盘模式 | `dataStore.ts`（tmp + rename + backup）、`review.ts`（目录 + `shell.openPath`） | 桌面端资源落盘照抄该模式，风格一致 |
| `AppData.version` 只有 2 | `shared/types.ts:76`；`dataCodec.ts:18,38` 只接受 1/2 且写死返回 2 | 加字段必须升到 3 并同步改两处校验 |

---

## 3. 数据模型

### 3.1 类型定义（`src/shared/types.ts`）

```ts
/** 资源元数据：只描述"这张图是什么"，不含像素数据。 */
export interface StickerAsset {
  id: string            // uuid，同时是磁盘文件名 / 对象名
  kind: 'image'
  mime: string          // image/webp | image/jpeg | image/png
  bytes: number         // 原始文件字节数（用于配额统计）
  width: number         // 压缩后像素宽
  height: number
  thumbBytes: number    // 缩略图字节数
  checksum: string      // 原始文件 sha-256 前 16 位，用于去重
  createdAt: string
  uploadedAt?: string   // 已上传云端的时间；空表示仅本地
}

/** 画布上的一张照片贴纸。 */
export interface QuadrantSticker {
  id: string
  assetId: string
  eventId?: string      // 挂靠的事件；非空时 x/y 为相对事件左上角的偏移（世界单位）
  x: number
  y: number             // 世界坐标，y 向上为正（与事件卡一致）
  width: number         // 世界单位宽；高 = width / 宽高比，不单独存
  rotation: number      // 度，-180..180
  opacity: number       // 0.3..1，默认 1
  z: number             // 全局层级
  caption?: string
  createdAt: string
  updatedAt: string
}

export interface AppData {
  version: 3
  goals: Goal[]
  events: QuadrantEvent[]
  weekPresets: WeekPreset[]
  weekEvents: WeekEvent[]
  stickers: QuadrantSticker[]     // 新增
  assets: StickerAsset[]          // 新增
  weekCounterOffset: number
}
```

设计要点：

- **只存 `width`**，高度由宽高比推导 → 无法把图片拉变形，也少一个同步字段。
- **挂靠用相对坐标**（`eventId` 非空时 `x/y` 是相对事件左上角的偏移）→ 事件移动时贴纸自动跟随，无需批量改写。解除挂靠时把相对坐标折算为绝对坐标一次。
- **`assets` 与 `stickers` 分离** → 同一张图可以贴多次（复用同一个 `assetId`，不重复占空间）；删除贴纸时资源可留待 GC。
- **`z` 全局统一**，贴纸与事件卡同层排序（见 5.3）。

### 3.2 体积预算

| 项 | 单条目大小 | 说明 |
|---|---|---|
| 一个 `StickerAsset` | ≈ 230 字节 | 12 个字段 + uuid |
| 一个 `QuadrantSticker` | ≈ 180 字节 | 10 个字段 |
| 100 张贴纸 | ≈ 41 KB | 相比当前 `AppData` 仍在同一量级 |

**结论：元数据随 `AppData` 走同步没问题；像素数据必须走独立通道。**

---

## 4. 为什么不能把图片放进 `AppData`

这一节是整套设计的依据，请勿跳过——它决定了后面所有架构选择。

| 后果 | 机制 | 证据 |
|---|---|---|
| 网页端会**静默丢数据** | localStorage 配额约 5 MB；单张 2 MB 照片 base64 后 ≈ 2.7 MB。写入超限时 `setItem` 抛 `QuotaExceededError`，而 `platformApi.ts:99-101` 的 `saveData` 用 `try/catch` **静默吞掉异常** | `platformApi.ts:99-101` |
| 每次编辑都变慢 | 拖动一个事件 → `saveSoon` → `JSON.stringify(整个 AppData)` → base64 图片全部重新序列化 | `appStore.ts:99-104` |
| 实时同步会整体失效 | `user_data` 是单行 jsonb，每次 upsert 全量传输；Supabase Realtime 的 payload 有 1 MB 上限，超限后**该订阅静默失效**（不报错） | `cloudSync2.ts:27,35,40` |
| 云端行膨胀 | 每加一张图，`user_data.data` 增长 1.33 倍（base64 膨胀），每次同步都要传全量 | 同上 |

**因此：`AppData` 里只放"引用 + 元数据"，像素走三条独立通道（磁盘 / IndexedDB / Supabase Storage）。**

---

## 5. 资源存储架构

### 5.1 三后端统一抽象

新增 `src/renderer/src/lib/assetStore.ts`，暴露同一组接口，按运行环境选择实现：

```ts
export interface AssetStore {
  /** 写入资源（主图 + 缩略图），返回 assetId。 */
  put(assetId: string, main: Blob, thumb: Blob): Promise<void>
  /** 读取；未命中返回 null。 */
  get(assetId: string): Promise<{ main: Blob; thumb: Blob } | null>
  /** 仅读缩略图（zoom 较小时优先）。 */
  getThumb(assetId: string): Promise<Blob | null>
  has(assetId: string): Promise<boolean>
  remove(assetId: string): Promise<void>
  /** 本环境是否存在"云端副本"概念。 */
  readonly remote: boolean
}
```

| 环境 | 主存储 | 读取路径 | 写入时机 |
|---|---|---|---|
| 桌面 | `%APPDATA%/象限/attachments/<assetId>.webp` + `.thumb.webp` | 新增 IPC `asset:read` 返回 `ArrayBuffer` → renderer 转 `objectURL` | 导入时立即写盘 |
| 网页 | Supabase Storage `attachments/<userId>/<assetId>.webp` | 先查 IndexedDB，未命中则 `storage.download()` 并写入缓存 | 导入时写 IndexedDB；`uploadedAt` 为空时在"上传到云端"或空闲时上传 |
| 内存 | `Map<assetId, { url, lastUsed }>`，LRU 上限 60 张 | 命中直接复用 | 超出时 `URL.revokeObjectURL` |

桌面端 IPC 新增（`preload/index.ts` + `main/index.ts` + 新的 `main/assets.ts`）：

```ts
assetWrite(assetId: string, main: ArrayBuffer, thumb: ArrayBuffer): Promise<void>
assetRead(assetId: string, kind: 'main' | 'thumb'): Promise<ArrayBuffer | null>
assetDelete(assetId: string): Promise<void>
assetList(): Promise<string[]>          // 用于 GC 扫描
```

落盘实现照抄 `dataStore.ts:34-43` 的 `写 tmp → rename` 模式（避免半截文件）。目录用 `app.getPath('userData')/attachments`，与 `review.ts:7-9` 的 `reviews/` 并列。

### 5.2 Supabase Storage 配置

```sql
-- 私有 bucket
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- 仅本人可读写自己目录：attachments/<uid>/<assetId>.webp
create policy "attachments owner read"
  on storage.objects for select
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments owner insert"
  on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments owner delete"
  on storage.objects for delete
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
```

客户端读取：`supabase.storage.from('attachments').download(path)` 返回 `Blob`（自动带 JWT，无需签名 URL）。上传用 `upload(path, blob, { upsert: false, contentType })`，同名即视为已存在（`assetId` 是 uuid + checksum 去重，天然幂等）。

> 若一期同步改用了 broadcast 通道（见修复方案 3.4），则**不需要** `alter publication supabase_realtime add table ...`；storage 与 realtime 互不影响。

### 5.3 层级（决定"拼贴感"）

现状事件卡在 `.event-layer` 内按 DOM 顺序堆叠，`.event-card` 没有显式 `z-index`。要让贴纸真正"贴"在卡片上（拼贴感），必须统一层空间：

| 方案 | 效果 | 建议 |
|---|---|---|
| A｜贴纸永远在卡片之下 | 贴纸像是桌面底色，不会遮挡文字 | 实现简单，但失去拼贴感 |
| B｜统一 `z` 全局排序：事件卡初始 `z = 100 + 索引`，贴纸插入时 `z = maxZ + 1` | 可随意压叠，符合"拼贴/幕布"直觉 | **推荐**，需给 `QuadrantEvent` 也加 `z`（升到 version 3 时一并加，默认 100） |

方案 B 的代价：需要在右键菜单里增加"置顶/置底"，以及拖动时"抬起即置顶"。

---

## 6. 导入管线

### 6.1 入口（四个）

| 入口 | 桌面 | 手机 | 实现 |
|---|---|---|---|
| 画布菜单 → "添加照片" | ✔ | ✔ | 菜单项 → 触发隐藏的 `<input type="file" accept="image/*" multiple>` |
| 拖文件到画布 | ✔ | — | `dragover`/`drop`（注意 `DayView.tsx:199-219` 已有可参考的 drop 处理） |
| `Ctrl+V` 粘贴 | ✔ | — | `paste` 事件读 `ClipboardItem`（Chrome 可用；iOS Safari 需用户手势，走入口 1） |
| 长按画布 → 粘贴 | — | ✔ | 复用底部 action sheet |

移动端**必须**由用户手势触发 `input.click()`，否则 iOS Safari 会拦截。

### 6.2 处理流程

```
文件 → 校验（mime / 大小上限 20 MB）
     → 解码（createImageBitmap，Safari 回退 Image + objectURL）
     → 计算 checksum（原始字节 sha-256 前 16 位）
     → 已存在同 checksum 的 asset ？复用 : 生成新 assetId
     → 缩放主图：长边 > 1600px 才缩，输出 image/webp quality 0.82
     → 生成缩略图：长边 ≤ 320px
     → assetStore.put()（桌面写盘 / 网页写 IndexedDB）
     → 落 reasons：AppData.assets 增条目
     → 生成 sticker：位置 = 导入落点（或视口中心），避让已有贴纸与事件卡
     → 一次性提交（saveSoon）
```

关键参数与理由：

| 参数 | 值 | 理由 |
|---|---|---|
| 主图长边上限 | 1600px | 2.5x 最大缩放下，1600px 最长可覆盖约 640 逻辑像素宽度；再大对 32px 高的卡片场景无收益 |
| 主图格式 | `image/webp` q=0.82 | 相对 JPEG 体积约减 25–35%，全平台支持（iOS 14+） |
| 缩略图长边 | 320px | 当 `zoom < 0.6` 或贴纸屏幕宽度 < 320px 时替代渲染 |
| 单文件上限 | 20 MB | 超过的多为原图/RAW，直接拒绝并给出提示 |
| `checksum` 去重 | sha-256 前 16 位 | 同一张图重复导入不重复占空间 |

### 6.3 失败处理（不使用静默 catch）

| 失败 | 行为 |
|---|---|
| 非图片 / 解码失败 | Toast「无法识别该文件，请使用 JPG/PNG/WebP」 |
| 超过 20 MB | Toast「图片过大（xx MB），上限 20 MB」 |
| HEIC（iPhone 原生格式） | Toast「暂不支持 HEIC，请在系统相册中导出为 JPG」——**不引入解码库**，包体收益比不划算 |
| IndexedDB 写失败（Safari 隐私模式/配额） | Toast 明确说明"图片未能保存在本机"，并**不阻止元数据写入**（保证桌面端拉到元数据后能显示占位） |
| 磁盘写失败（桌面） | IPC 返回错误 → Toast + 不写入 `assets` |

---

## 7. 渲染与手势

### 7.1 渲染

贴纸渲染进 `.event-layer`（`QuadrantPage.tsx:556-559`），因此平移/缩放由既有的 `translate + scale` 一次性处理，贴纸只需写世界坐标：

```tsx
<div className="sticker-layer">
  {stickers.map((s) => (
    <StickerCard
      key={s.id}
      sticker={s}
      src={useAssetUrl(s.assetId, screenWidth < 320 ? 'thumb' : 'main')}
      selected={selectedStickerId === s.id}
      onGesture={...}   // 复用修复方案的手势内核
    />
  ))}
</div>
```

```css
.sticker-card {
  position: absolute;
  transform-origin: 0 0;
  will-change: transform;
  touch-action: none;          /* 与事件卡一致：禁止浏览器接管手势 */
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .38);
  overflow: hidden;
}
.sticker-card.selected { outline: 2px solid rgba(77, 163, 255, .9); }
.sticker-card img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
```

`left/top/width` 用世界单位 × `UNIT`，`transform: rotate(deg)` 承载旋转（旋转不进世界坐标，避免旋转后命中检测复杂化）。

### 7.2 手势（复用同一套内核）

| 手势 | 效果 |
|---|---|
| 轻触 | 选中，底部/侧边出现工具条 |
| 拖动（位移 > 8px） | 移动贴纸；接近事件卡中心且停留 > 400ms → 显示"挂靠"高亮，松手即挂靠 |
| 双指（贴纸上） | 缩放 + 旋转 |
| 选中后把手（≥44×44 命中区） | 右下角缩放、上方旋转 |
| 长按 | 打开贴纸菜单（置顶/置底/挂靠/解除挂靠/替换图片/删除/查看原图） |
| 双击 | 全屏查看原图 |

约束：`MIN_STICKER_UNITS = 3`、`MAX_STICKER_UNITS = 40`；旋转吸附到 15° 的整数倍（按住 `Shift` 时自由旋转）。

### 7.3 挂靠行为

- 挂靠判定：拖动结束点落在某事件卡矩形内（含外扩 8px）。
- 挂靠后 `eventId` 置位，`x/y` 改为相对该事件的偏移。
- 事件被删除 → 贴纸自动解除挂靠（在 `deleteEventFromList` 后加一次"孤儿贴纸解挂"清理）。
- 事件被拖动 → 贴纸跟随（无需额外逻辑，因为坐标是相对的）。
- 事件卡宽度变化（标题改长）→ 贴纸保持相对偏移，不重排。

### 7.4 性能

| 阈值 | 策略 |
|---|---|
| 贴纸 ≤ 20 张 | 全部渲染原图 |
| 屏幕宽度 < 320px | 渲染缩略图 |
| 贴纸 > 40 张 | 强制缩略图 + 只对选中项加载原图 |
| 总资源 > 200 MB | 提示用户清理（设置页显示占用） |

`<img>` 加 `loading="lazy"`、`decoding="async"`、`draggable={false}`。离开页面时统一 `revokeObjectURL`。

---

## 8. 同步与垃圾回收

### 8.1 分离同步

| 载荷 | 通道 | 时机 |
|---|---|---|
| `assets` / `stickers` 元数据 | 随 `AppData`（现有通道） | 与普通数据一致 |
| 像素（主图 + 缩略图） | Supabase Storage / 磁盘 | 网页端导入后空闲上传；桌面端在"上传到云端"时批量上传 |

结果：**"从云端恢复"只需几秒**（只搬元数据），图片按需懒加载。这是"图片不进主载荷"最大的用户体验收益。

### 8.2 上传状态机

```
local-only ──(在线且空闲/点上传)──> uploading ──> synced(uploadedAt)
     ↑                                   │
     └──────────失败（保留 local-only，重试）┘
```

使用 `assets[].uploadedAt` 标记，界面上以角标显示"未同步 N 张"。

### 8.3 垃圾回收

- 删除贴纸 → 只删 `stickers` 条目，`assets` 保留（可能被其他贴纸引用）。
- 提供"清理未引用资源"动作：扫描 `assets` 与 `stickers.assetId`、`events` 的引用差集，删除无引用且 `uploadedAt` 已存在的资源（含 Storage 对象）。
- 桌面端 `assetList()` 返回磁盘文件清单，与 `AppData.assets` 做差集，清理孤儿文件。

---

## 9. 迁移与兼容

| 项 | 处理 |
|---|---|
| `AppData.version` | 2 → 3 |
| `shared/types.ts` | `AppData.version: 3`，加 `stickers`、`assets`；`QuadrantEvent` 加可选 `z` |
| `main/dataCodec.ts` | `parseData` 接受 `1 \| 2 \| 3`；返回值改为 `version: 3` 并补 `stickers: []`、`assets: []`；新增 `normalizeSticker` / `normalizeAsset`（非法条目丢弃而非整体失败） |
| `lib/platformApi.ts` | `validAppData` 增加 `version === 3` 与两个数组的校验；**同时修正 `saveData` 的静默 `catch`**，让配额错误能被上报 |
| 既有用户数据 | 无需手工迁移：v2 的 `plan.json` 读入后自动补空数组；桌面 `%APPDATA%/象限/plan.json` 不受影响 |
| 云端旧数据 | 首次打开时 `validCloudData`（`cloudSync2.ts:16-19`）需同步接受 version 3，否则云端 v2 数据会被判为非法而回退到本地 |
| Electron | `main/index.ts` 注册 4 个 `asset:*` handler；`preload/index.ts` 暴露同名字段；`QuadrantApi` 接口扩展 |
| 打包 | `attachments/` 在 userData 下，不在安装目录，便携版打包无需改动（`electron-builder.yml` 不动） |

---

## 10. 分阶段实施与验收

| 阶段 | 内容 | 可独立上线 | 验收 |
|---|---|---|---|
| **P0-1** | 数据模型 + version 3 + 迁移（`types` / `dataCodec` / `platformApi` / `cloudSync2`） | 是（空功能） | `dataCodec.test.ts`、`platformApi.test.ts` 扩展；v2 数据无损读入 |
| **P0-2** | `AssetStore` 抽象 + 桌面 IPC + IndexedDB 实现 + 内存 LRU | 否 | 单测：写入→读取→删除；桌面真机验证文件落盘 |
| **P0-3** | 导入管线（文件/拖放/粘贴 + 压缩 + 缩略图 + checksum 去重） | 否 | 导入 5 张 3 MB 照片总耗时 < 6 s；本地存储增长 < 6 MB |
| **P0-4** | 渲染 + 拖动/缩放/旋转/删除 + 层级 | **是** | 手机与桌面各走一遍完整操作 |
| **P1-1** | Supabase Storage 上传/下载 + `uploadedAt` 状态 + 懒加载 | 是 | 手机上导入 → 桌面"从云端恢复" → 图片自动下载显示 |
| **P1-2** | 挂靠事件 + 孤儿清理 + 资源占用统计 | 是 | 拖动事件，贴纸跟随；删除事件，贴纸解挂不消失 |
| **P1-3** | "清理未引用资源"动作 | 是 | 构造 3 个孤儿资源，全部清掉 |
| **P2** | 旋转把手、批量导入、图片上叠文字 | — | 视需要 |

**量化验收指标**（P0 结束时应全部满足）：

- `AppData` JSON 总量 < 200 KB（100 张贴纸规模）；
- 导入 5 张 3 MB 照片后，localStorage 增长 < 5 KB（像素不进 localStorage）；
- 主图平均压缩比 > 60%（3 MB → < 1.2 MB）；
- 拖动 40 张贴纸时帧率 ≥ 50 fps（375×667，中端机模拟）。

**回归要求**：每次改动后 `tsc`（两套配置）零错误、`vitest` 全绿；新增 `assetStore.test.ts`、`stickerRules.test.ts`（坐标换算、挂靠、解挂、GC 差集均设在纯函数层）。

---

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| iOS Safari 的 ITP 会在 7 天未访问后清理 IndexedDB | 手机上图片缓存丢失 | 云端副本是权威；重进页面自动重下。**不能只依赖 IndexedDB** |
| HEIC 不支持 | iPhone 用户直接选原图会失败 | 明确提示导出为 JPG；P2 可评估引入 `heic-to`（约 +90 KB） |
| `createImageBitmap` 在旧版 Safari 缺失 | 导入失败 | 回退到 `Image` + `objectURL` + `<canvas>` 绘制 |
| 内存中的 objectURL 泄漏 | 长会话内存增长 | LRU + 卸载时统一 revoke；纳入验收项 |
| 与实时同步并发 | 一端删图片、另一端在读 | 读不到时显示占位图（不崩溃）；`assets` 是元数据，GC 只在显式操作时执行 |
| 云端存储配额 | Supabase 免费额度（1 GB） | 压缩后单张平均 300–600 KB；设置页显示占用，超 80% 提示 |

---

## 12. 待确认的决策点

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| E1 | 层级模型 | A 贴纸永远在事件卡之下／B 统一 `z` 全局排序 | **B**，否则没有"拼贴"效果；代价是事件卡也要加 `z` 字段 |
| E2 | 云端图片同步本期是否做 | ① P0 先做本地（桌面可用、手机可用，但跨设备不同步图）② P0 + P1 一起 | ①，先验证交互与体积，P1 紧接着做 |
| E3 | 单文件上限 | 10 MB / 20 MB / 不限（仅压缩） | 20 MB |
| E4 | 是否允许一张图贴多次 | 允许（复用 assetId）／每次导入生成副本 | 允许，去重免费 |
| E5 | 挂靠事件是否本期做 | 是／否（P2） | 是，P1-2；这是"可拼贴事件"的核心体验 |
