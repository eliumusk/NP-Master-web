# Genomine 交接：自托管版

目标：Next.js 网站和 GPU Worker 都部署到新服务器；Supabase 沿用现有项目。

## 接手人先回复群里

```text
GitHub 账号/邮箱：
Supabase 接收邀请的邮箱：
新服务器公网 IP：
SSH 端口和用户名：
服务器所在国家/地区：
GPU 型号、数量、单卡显存：
CUDA/驱动版本：
可用磁盘和部署目录：
网站是否由你们配置 Nginx/Caddy 和 HTTPS：
计划使用哪家域名注册商（不迁移注册商则填“暂不迁移”）：
可切换时间：
```

不要在群里发密码、私钥或 Supabase service role key。

## 1. 账号与代码

1. 原负责人邀请接手人进入现有 Supabase Organization。
2. 原负责人整理并推送两个仓库，把最终 commit 发群里：
   - `https://github.com/eliumusk/NP-Master-web.git`
   - `https://github.com/eliumusk/npmaster.git`
3. 原负责人提供 GPU Conda 环境 `evo2_bgc` 的环境导出文件或安装步骤。
4. 新服务器安装 Node.js 20+、Python、rsync、Prodigal、DIAMOND、HMMER，并准备 PyTorch/Evo2 GPU 环境。

## 2. 两台服务器直接传文件

旧服务器 SSH 地址为 `221.194.152.152`，本机 sshd 监听端口为 `2222`。新服务器只要能访问旧服务器 SSH，就可以主动拉取，不要求旧服务器反向访问新服务器。

以下命令在**新服务器**执行。旧服务器登录用户为 `root`，新服务器先配置好可登录旧服务器的 SSH 密钥。

```bash
OLD_USER='root'
OLD="$OLD_USER@221.194.152.152"
export RSYNC_RSH='ssh -p 2222'

ssh -p 2222 "$OLD" true
mkdir -p /data/genomine
cd /data/genomine
git clone https://github.com/eliumusk/NP-Master-web.git
git clone https://github.com/eliumusk/npmaster.git

mkdir -p \
  /data/genomine/models/hub \
  /data/genomine/npmaster/experiments/evo2_per_token_unet/train_runs/full_weakneg_bce_w05_ddp4_gb64_seed0 \
  /data/genomine/npmaster/experiments/evo2_mibig_type/run_full \
  /data/genomine/NP-Master-web/runtime/data

rsync -a --info=progress2 \
  "$OLD:/data/muskliu/npmaster/experiments/evo2_per_token_unet/train_runs/full_weakneg_bce_w05_ddp4_gb64_seed0/best.pt" \
  /data/genomine/npmaster/experiments/evo2_per_token_unet/train_runs/full_weakneg_bce_w05_ddp4_gb64_seed0/

rsync -a --info=progress2 \
  "$OLD:/data/muskliu/npmaster/experiments/evo2_mibig_type/run_full/type_head.joblib" \
  /data/genomine/npmaster/experiments/evo2_mibig_type/run_full/

rsync -a --info=progress2 \
  "$OLD:/data/public_models/hub/models--arcinstitute--evo2_7b" \
  /data/genomine/models/hub/

rsync -a --info=progress2 \
  "$OLD:/data/syh/NP-Master-web/runtime/data/pfam" \
  /data/genomine/NP-Master-web/runtime/data/

rsync -a --info=progress2 \
  "$OLD:/data/syh/NP-Master-web/runtime/data/mibig" \
  /data/genomine/NP-Master-web/runtime/data/
```

共约 18 GB。不要复制 `npmaster/data`、训练数据、历史实验或 `runtime/cache`。传输后用 `sha256sum` 核对两个权重文件。

## 3. 部署网站与 Worker

### 配置

旧服务器已经存在两份完整配置，可用上一节的 SSH 连接直接复制到**新服务器**，不用逐项手抄密钥：

```bash
OLD_USER='root'
export RSYNC_RSH='ssh -p 2222'
OLD="$OLD_USER@221.194.152.152"

rsync -a "$OLD:/data/syh/NP-Master-web/backend/.env" \
  /data/genomine/NP-Master-web/backend/.env
rsync -a "$OLD:/data/syh/NP-Master-web/apps/web/.env.local" \
  /data/genomine/NP-Master-web/apps/web/.env.local
chmod 600 /data/genomine/NP-Master-web/backend/.env \
  /data/genomine/NP-Master-web/apps/web/.env.local
```

然后修改配置中的旧路径和 GPU 参数：

- `backend/runtime.env`：把 `/data/syh/...` 改为 `/data/genomine/NP-Master-web/...`。
- `NPMASTER_REPO_ROOT=/data/genomine/npmaster`
- `HF_HUB_CACHE=/data/genomine/models/hub`，`HF_HUB_OFFLINE=1`
- `EXTRACT_HOSTS=localhost`，GPU 数量按新服务器调整。
- `USE_PRECOMPUTED_9G_PROBS=false`

环境文件通过 SSH 直传即可，不提交 Git。SSH 使用新临时密钥，不使用聊天中发送过的私钥。

### 构建与检查

```bash
cd /data/genomine/NP-Master-web
python3 -m venv .local/venv
.local/venv/bin/pip install -r backend/requirements.txt
.local/venv/bin/python -m pytest backend/tests

cd apps/web
npm ci
npm run lint
npm run typecheck
npm run build
```

### 启动

网站由维护人员配置为 systemd 服务，生产启动命令为：

```bash
cd /data/genomine/NP-Master-web/apps/web
npm run start -- -H 127.0.0.1 -p 3000
```

用 Nginx/Caddy 将 80/443 反代到 `127.0.0.1:3000` 并配置 HTTPS。若使用 Nginx，上传限制不能低于网站 FASTA 上限，例如 `client_max_body_size 50m`。

Worker 使用现有模板：

```bash
cd /data/genomine/NP-Master-web
sudo cp backend/systemd/npmaster-worker.service /etc/systemd/system/
sudoedit /etc/systemd/system/npmaster-worker.service
```

把 `WorkingDirectory`、两个 `EnvironmentFile` 和 `ExecStart` 改为新路径。切换时先停旧 Worker，再执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now npmaster-worker
journalctl -u npmaster-worker -f
```

确认模型加载成功后，提交一个测试 FASTA，确认任务完成且结果可下载。

## 4. 域名切换

### 推荐：暂不迁移注册商

域名继续买在 Vercel，不需要 Vercel Pro：

1. 先备份现有 DNS 记录，尤其是 MX、TXT 和子域名记录。
2. Vercel Dashboard → **Domains** → `genomine.bio` → **Advanced Settings** → Vercel DNS。
3. 将 `@` 和 `www` 的 A 记录指向新服务器公网 IP；新记录可覆盖 Vercel 默认记录。
4. 验证：

```bash
dig +short A genomine.bio
dig +short A www.genomine.bio
curl -I https://www.genomine.bio
```

DNS 生效前保留 Vercel 项目用于回退。若需回退，删除指向新服务器的自定义 A 记录，恢复 Vercel 默认解析。

### 可选：把域名迁出 Vercel

1. 确认新注册商支持 `.bio`，并确认域名没有注册/转移后 60 天锁等限制。
2. Vercel Dashboard → **Domains** → 域名右侧三点菜单 → **Transfer out**，获取 authorization code。
3. 在新注册商发起转入并提交授权码；Vercel 不需要再次确认，转移最长可能需要一周。
4. 转移前复制全部 DNS 记录；若同时更换 nameservers，先在新 DNS 服务商重建并验证记录。

参考：[Vercel 域名转移说明](https://vercel.com/docs/domains/working-with-domains/transfer-your-domain)、[Vercel DNS 说明](https://vercel.com/docs/domains/managing-dns-records)。

如果新网站服务器在中国大陆，先向云厂商确认 ICP备案、域名实名认证和注册商要求，再切换 DNS。
