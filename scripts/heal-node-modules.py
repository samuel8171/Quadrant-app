# 按 package-lock.json 补齐 node_modules 里缺失的包（离线/半离线修复）
#
# 为什么不用 npm：本机 npm 的 shim 异常，而 `npm ci` 会先删掉整个 node_modules
# （一旦中途失败就只剩半棵树）。这里只做"缺什么补什么"：地址与 integrity 都取自
# package-lock.json，逐个校验 sha512，失败就报出来，不动已有的包。
#
# 用法：python scripts/heal-node-modules.py [--dry]
import base64, hashlib, json, os, shutil, subprocess, sys, tarfile, tempfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, 'package-lock.json')
NM = os.path.join(ROOT, 'node_modules')
DRY = '--dry' in sys.argv

lock = json.load(open(LOCK, encoding='utf-8'))
pkgs = lock['packages']


def win_ok(meta):
    """按 os/cpu 过滤掉与当前平台无关的可选依赖。"""
    os_field = meta.get('os')
    if os_field and 'win32' not in os_field:
        return False
    return True


missing = []
for key, meta in pkgs.items():
    if not key.startswith('node_modules/'):
        continue
    rel = key[len('node_modules/'):]
    if os.path.exists(os.path.join(NM, rel)):
        continue
    if not win_ok(meta):
        print(f'  跳过(平台无关) {rel}')
        continue
    if not meta.get('resolved'):
        print(f'  ⚠ 锁里没有 resolved: {rel}')
        continue
    missing.append((rel, meta))

print(f'待补 {len(missing)} 个包')

tmpdir = os.path.join(ROOT, 'tmp', 'nmfix')
os.makedirs(tmpdir, exist_ok=True)
fails = []
for rel, meta in missing:
    ver = meta.get('version')
    url = meta['resolved']
    integ = meta.get('integrity', '')
    tgz = os.path.join(tmpdir, f'{rel.replace("/", "_")}-{ver}.tgz')
    print(f'  → {rel}@{ver}')
    if DRY:
        continue
    try:
        if not os.path.exists(tgz):
            req = urllib.request.Request(url, headers={'User-Agent': 'node-modules-heal'})
            with urllib.request.urlopen(req, timeout=60) as r, open(tgz, 'wb') as f:
                shutil.copyfileobj(r, f)
        raw = open(tgz, 'rb').read()
        if integ.startswith('sha512-'):
            got = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
            if got != integ:
                raise RuntimeError(f'integrity 不匹配\n     期望 {integ}\n     实得 {got}')
        dest = os.path.join(NM, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.rmtree(dest, ignore_errors=True)
        with tempfile.TemporaryDirectory(dir=tmpdir) as td:
            with tarfile.open(tgz) as t:
                t.extractall(td, filter='data')
            # 绝大多数 npm tarball 的根目录叫 package/，但少数（例如 @types/*）
            # 用的是自己的包名 ⇒ 只有唯一子目录时就取它，否则直接搬整个临时目录。
            extracted = os.path.join(td, 'package')
            if not os.path.isdir(extracted):
                subs = [os.path.join(td, s) for s in os.listdir(td)]
                dirs = [s for s in subs if os.path.isdir(s)]
                extracted = dirs[0] if len(dirs) == 1 else td
            shutil.move(extracted, dest)
        print('     ✓ 已解包并校验')
    except Exception as e:  # noqa: BLE001
        fails.append((rel, str(e)))
        print(f'     ✗ {e}')

print()
if fails:
    print(f'❌ {len(fails)} 个失败:')
    for rel, err in fails:
        print(f'   - {rel}: {err[:200]}')
    sys.exit(1)
print('✅ 补齐完成')
