# 配合 Supabase 的操作清单

面向：Samuel。目标是让网页端与桌面端的云同步真正可用。
代码侧已经改完，这里全是**你在 Supabase 控制台要点的东西**。

---

## 0. 先说结论：你不需要改代码

`src/renderer/src/lib/cloudSync2.ts` 里已经写死了你的项目地址与公开密钥：

```
SUPABASE_URL      = https://nktsnjbkvdyhxdjfbxkh.supabase.co
SUPABASE_ANON_KEY = sb_publishable_...（publishable key，本来就是公开值）
```

所以只要 Supabase 那边的表与账号没问题，代码不用动。
下面四件事做完就通了。

> 关于这个 key 是否安全：`sb_publishable_*` 就是设计成放在前端的，它本身
> 不等于授权。真正的防线是 RLS——所以第 2 步不能省。

---

## 1. 建表与策略（把 `supabase/schema.sql` 跑一遍）

控制台 → **SQL Editor** → New query → 把仓库里 `supabase/schema.sql`
整段粘进去 → Run。

脚本是幂等的（`if not exists` / `drop + create`），重复跑不会破坏已有数据，
所以哪怕你以前建过表，也可以放心重跑一次把它对齐。

跑完把文件末尾那段自检 `select` 单独执行一次，五项应全是 `true`：

| 检查项 | 含义 | 不通过会怎样 |
|---|---|---|
| 数据表已存在 | `public.user_data` | 同步全部失败 |
| RLS 已开启 | 行级安全 | **任何人拿到 anon key 就能读写你的数据** |
| 三条策略齐备 | select / insert / update | 表现为"能登录但读/写不到" |
| updated_at 触发器就绪 | 服务端盖章修订号 | 设备时钟不准时可能漏拉更新 |
| 照片 bucket 就绪 | `attachments`（私有） | 只影响之后的照片功能，不影响现在 |

### 为什么这次要给 `updated_at` 加触发器

同步用 `updated_at` 当"修订号"判断云端有没有变。旧实现是客户端写
`new Date().toISOString()`，也就是**用本机时钟**。两台设备时钟差几分钟，
就会有一端误判"云端没变"从而跳过拉取。交给 `now()` 更可靠。

---

## 2. 开一个能登录的账号

应用把用户名拼成邮箱：`<用户名>@quadrant.app`（见 `usernameToEmail`）。
所以不需要真实邮箱，但要建一个对应的用户。

控制台 → **Authentication** → **Users** → `Add user` → `Create new user`：

- Email：沿用你原来的用户名，即 `samuel711@quadrant.app`
- Password：**建议现在就改一个新的**
- **务必把 `Auto Confirm User` 打开**——邮箱是虚构的，收不到确认信，
  不开这个开关登录会一直失败

然后 Authentication → **Providers** → Email，把 **Confirm email** 关掉。

### 为什么建议换密码

仓库历史里曾有一份旧构建（`web-dist/`）带着明文口令被提交过，
克隆过这个仓库的人都拿得到。这条已在 `.gitignore` 里拦掉，但**改密码是唯一
真正的补救**，而且顺便把自己从"为了不泄密而不敢公开仓库"里解放出来。

---

## 3. 确认 Realtime 不用配

**这一步现在什么都不用做**，写在这里是为了让你别照着旧教程去开。

- 旧代码用 `postgres_changes` 订阅 → 必须把 `user_data` 加进
  `supabase_realtime` publication，而仓库里没有任何地方做过这件事，
  没手工开启的话推送会**静默失效**（不报错，只是永远收不到）。
- 新代码改用 **broadcast** 通道，走同一根 WebSocket，不需要任何数据库侧
  配置。而且顺带修掉了另外两个问题：整行 jsonb 会随数据增长撞 payload
  上限；旧订阅只监听 `UPDATE`，而首次写入是 `INSERT`，收不到。

---

## 4. 自检顺序

按这个顺序走，出问题时能一眼看出卡在哪一层：

1. **浏览器**：打开 https://samuel8171.github.io/Quadrant-app/ → 用第 2 步的
   账号登录 → 改一条数据 → 刷新页面，数据还在（说明本地存储 OK）
2. **跨设备**：手机上做同样的改动 → 桌面端点「从云端恢复」→ 确认框里
   「云端」的条数与时间是你刚改的（说明上传通了）
3. **反方向**：桌面端改一条 → 点「上传到云端」→ 手机刷新（说明下发通了）

第 1 步不通过看登录（第 2 步）；第 2 步不通过看 RLS 与策略（第 1 步）。

---

## 5. 我这边没验到的部分（说清楚）

- **真实凭据下的端到端同步我没跑过**。`scripts/sync-probe.mjs` 里的
  Supabase REST 与 auth 全是假响应，验证的是逻辑与界面，不等于连上真库。
  所以第 4 步麻烦你走一遍。
- **"双设备并发"场景没测**。当前模型是整份覆盖、没有行级合并，两台设备同时
  改同一份数据时，后写的赢、先写的会丢。这是设计取舍不是缺陷，但你需要知道。

---

## 6. 免费额度

照片功能上线前不必在意：现在一个用户的 `user_data` 只有一行，
真实数据 10 KB 上下。照片走 Storage（免费 1 GB），压缩后单张约 300–600 KB。
等真的开始堆照片了，再回来看占用也不迟。
