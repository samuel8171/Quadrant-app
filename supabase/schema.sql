-- 象限 · Supabase 初始化脚本
-- 用法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → Run。
-- 本脚本可重复执行（全部是 if not exists / drop + create），不会破坏已有数据。

-- ============================================================ 1. 数据表
-- 每个用户一行，整份 AppData 塞在 data(jsonb) 里。
-- 这是"单行整份覆盖"模型：同步粒度是整份，没有行级合并。
create table if not exists public.user_data (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================ 2. 行级安全
-- 必须开启。关闭的话，任何拿到 anon key 的人都能读写所有人的数据
-- （anon key 是公开值，浏览器里就能看到）。
alter table public.user_data enable row level security;

drop policy if exists "user_data select own" on public.user_data;
create policy "user_data select own" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "user_data insert own" on public.user_data;
create policy "user_data insert own" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_data update own" on public.user_data;
create policy "user_data update own" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================ 3. updated_at 由服务端盖章
-- 客户端把 updated_at 当"修订号"用来判断云端是否变了。
-- 如果由客户端时钟写入，一台时钟不准的设备会产生错误修订号，
-- 导致另一台设备误判"云端没变"而跳过拉取。交给服务端更可靠。
create or replace function public.touch_user_data()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before insert or update on public.user_data
  for each row execute function public.touch_user_data();

-- ============================================================ 4. 照片贴纸的私有 bucket
-- 四象限照片功能（P1 阶段）才会用到。现在建好不影响任何现有功能：
-- 照片本身不进 AppData，只走这个 bucket + 本地 IndexedDB / 磁盘。
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- 只允许本人读写自己的目录：attachments/<uid>/<assetId>.webp
drop policy if exists "attachments owner read" on storage.objects;
create policy "attachments owner read" on storage.objects
  for select using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments owner insert" on storage.objects;
create policy "attachments owner insert" on storage.objects
  for insert with check (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments owner update" on storage.objects;
create policy "attachments owner update" on storage.objects
  for update using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments owner delete" on storage.objects;
create policy "attachments owner delete" on storage.objects
  for delete using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================ 5. 自检
-- 跑完上面的语句后，再单独运行这一段。五项应全部为 true。
select
  to_regclass('public.user_data') is not null                                as "数据表已存在",
  coalesce((select relrowsecurity from pg_class
            where oid = 'public.user_data'::regclass), false)                as "RLS 已开启",
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'user_data') >= 3             as "三条策略齐备",
  exists (select 1 from pg_trigger
          where tgname = 'user_data_touch' and not tgisinternal)             as "updated_at 触发器就绪",
  exists (select 1 from storage.buckets where id = 'attachments')            as "照片 bucket 就绪";

-- 说明：本方案不需要 `alter publication supabase_realtime add table ...`。
-- 同步通知走 Supabase 的 broadcast 通道（同一根 WebSocket），不依赖数据库侧
-- 的 realtime 配置。旧代码用的是 postgres_changes，那才需要把表加进 publication
-- ——而 schema 里从来没写过这一步，没在控制台手工开启的话推送会静默失效。
