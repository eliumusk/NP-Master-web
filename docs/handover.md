# Genomine 接手部署指南

这份文档给**新维护人**使用。你负责在新服务器完成部署；原负责人只需提供账号邀请、旧服务器 SSH 登录方式和域名授权码。

## 当前情况

- 网站：Next.js 15，当前由 Vercel 托管，最终迁到你的服务器。
- 数据库和文件存储：继续使用现有 Supabase，不需要迁移数据库。
- 代码：以下两个公开仓库的 `main` 分支：
  - `https://github.com/eliumusk/NP-Master-web.git`
  - `https://github.com/eliumusk/npmaster.git`
- 旧服务器：`root@221.194.152.152`，SSH 端口 `2222`。
- 新服务器：`/data/genomine`，1 张 GPU，使用 Nginx/Caddy 配置 HTTPS。
- 新服务器公网 IP 尚未提供，不影响先部署；切换域名前必须确认。
- U-Net `best.pt` 和类型模型 `type_head.joblib` 已在 `npmaster` 仓库，不需要单独传输。

## 1. 接受权限并拉取代码

接受两个 GitHub 仓库邀请和 Supabase Organization 邀请。向原负责人获取能登录旧服务器的 SSH 方式，然后在新服务器执行：

```bash
ssh -p 2222 root@221.194.152.152 true
mkdir -p /data/genomine
cd /data/genomine
git clone https://github.com/eliumusk/NP-Master-web.git
git clone https://github.com/eliumusk/npmaster.git
```

如果 SSH 测试失败，先解决新服务器到旧服务器 `221.194.152.152:2222` 的连接，再继续。

## 2. 复制运行资产和现有配置

在**新服务器**执行：

```bash
OLD='root@221.194.152.152'
export RSYNC_RSH='ssh -p 2222'

mkdir -p /data/genomine/models/hub /data/genomine/NP-Master-web/runtime/data

rsync -a --info=progress2 \
  "$OLD:/data/public_models/hub/models--arcinstitute--evo2_7b" \
  /data/genomine/models/hub/

rsync -a --info=progress2 \
  "$OLD:/data/syh/NP-Master-web/runtime/data/pfam" \
  /data/genomine/NP-Master-web/runtime/data/

rsync -a --info=progress2 \
  "$OLD:/data/syh/NP-Master-web/runtime/data/mibig" \
  /data/genomine/NP-Master-web/runtime/data/

rsync -a "$OLD:/data/syh/NP-Master-web/backend/.env" \
  /data/genomine/NP-Master-web/backend/.env
rsync -a "$OLD:/data/syh/NP-Master-web/apps/web/.env.local" \
  /data/genomine/NP-Master-web/apps/web/.env.local
```

复制内容包括约 13 GB Evo2-7B、Pfam、MIBiG 和现有 Supabase 配置。不要复制 `npmaster/data`、训练数据、历史实验或 `runtime/cache`。

## 3. 安装运行环境

安装 Node.js 20+、Miniconda、Python 和 rsync，然后执行：

```bash
conda env create -p /data/genomine/conda/evo2_bgc \
  -f /data/genomine/npmaster/environment.yml

conda create -p /data/genomine/conda/tools \
  -c conda-forge -c bioconda prodigal diamond hmmer -y

cd /data/genomine/NP-Master-web
python3 -m venv .local/venv
.local/venv/bin/pip install -r backend/requirements.txt
```

`environment.yml` 使用 PyTorch 2.7/CUDA 12.8。先运行 `nvidia-smi` 确认 GPU 和驱动，再进行后续测试。

## 4. 修改路径和单卡配置

替换旧路径：

```bash
cd /data/genomine/NP-Master-web
sed -i \
  -e 's|/data/muskliu/npmaster|/data/genomine/npmaster|g' \
  -e 's|/data/syh/NP-Master-web|/data/genomine/NP-Master-web|g' \
  -e 's|/data/public_models/hub|/data/genomine/models/hub|g' \
  backend/.env backend/runtime.env
```

在 `backend/.env` 末尾追加以下配置；如果已有同名变量，以追加的值为准：

```bash
cat >> backend/.env <<'EOF'
NPMASTER_REPO_ROOT=/data/genomine/npmaster
PYTHON_BIN=/data/genomine/conda/evo2_bgc/bin/python
PRODIGAL_BIN=/data/genomine/conda/tools/bin/prodigal
DIAMOND_BIN=/data/genomine/conda/tools/bin/diamond
HMMER_BIN=/data/genomine/conda/tools/bin/hmmscan
EXTRACT_HOSTS=localhost
EXTRACT_GPUS_PER_HOST=1
MODEL_DAEMON_GPUS=0
WORKER_MAX_JOBS=1
USE_PRECOMPUTED_9G_PROBS=false
HF_HUB_CACHE=/data/genomine/models/hub
HF_HUB_OFFLINE=1
EOF
```

Supabase 配置已经在第 2 步复制，不需要重新创建项目或执行数据库迁移。

## 5. 构建并启动服务

### 5.1 验证构建

```bash
cd /data/genomine/npmaster
/data/genomine/conda/evo2_bgc/bin/python -m pytest tests -q

cd /data/genomine/NP-Master-web
.local/venv/bin/python -m pytest backend/tests

cd apps/web
npm ci
npm run lint
npm run typecheck
npm run build
```

### 5.2 启动网站

生产启动命令：

```bash
cd /data/genomine/NP-Master-web/apps/web
npm run start -- -H 127.0.0.1 -p 3000
```

由你配置 systemd 保活，并用 Nginx/Caddy 将 80/443 反代到 `127.0.0.1:3000`、配置 HTTPS。Nginx 上传限制可设为 `client_max_body_size 50m`。

### 5.3 启动 Worker

先确认旧 Worker 已停止，避免两个 Worker 同时领取任务。然后在新服务器执行：

```bash
cd /data/genomine/NP-Master-web
sudo cp backend/systemd/npmaster-worker.service /etc/systemd/system/
sudo sed -i 's|/data/syh/NP-Master-web|/data/genomine/NP-Master-web|g' \
  /etc/systemd/system/npmaster-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now npmaster-worker
journalctl -u npmaster-worker -f
```

确认 `runtime/cache/model_daemons/gpu0/daemon.log` 中 Evo2 和 U-Net 加载成功。

## 6. 验收并切换域名

1. 通过新服务器 IP 或临时域名打开网站，确认 `/api/health` 正常。
2. 提交一个小型 FASTA，确认任务最终为 `done`，结果可以查看和下载。
3. 确认 Supabase 中的任务记录、Storage 文件和 Worker 心跳正常。
4. 网站和 Worker 都通过后，再切换 DNS。

### 域名处理

最简单的切换方式是在 Vercel Dashboard → **Domains** → `genomine.bio` → **Advanced Settings** → Vercel DNS 中，把 `@` 和 `www` 的 A 记录指向新服务器公网 IP。这样不需要迁移注册商，也不需要 Vercel Pro。

如果按当前计划迁到阿里云：

1. 原负责人在 Vercel 的域名菜单中选择 **Transfer out**，提供 authorization code。
2. 你在阿里云发起转入，并完成实名认证、DNS 和备案流程。
3. 新网站服务器在中国大陆，先确认 ICP 备案要求，再将生产域名指向新服务器。

切换前备份原有 DNS 记录，并保留现有 Vercel 项目用于回退。

### 迁移期间继续更新网站

两个 GitHub 仓库都是公开仓库。新维护人获得 GitHub 权限后，向 `main` 推送代码仍会触发原 Vercel 项目自动部署，不需要加入 Vercel 或购买会员。自托管切换完成后，再由你决定是否停用 Vercel 项目。
