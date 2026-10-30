# 运行、部署与数据管理

## 当前服务关系

### 主网站

- 线上地址：`https://www.genomine.bio`
- 技术栈：Next.js 15 App Router
- 源码目录：`apps/web/`
- Vercel 项目：`np-master-web`
- 本地关联文件：`apps/web/.vercel/project.json`，该目录被 Git 忽略
- 主仓库远端：`https://github.com/eliumusk/NP-Master-web.git`

线上域名响应包含 `server: Vercel`，本地 `apps/web/` 保留了原项目的关联文件。Vercel 构建使用 `npm run build`，环境变量在 Vercel 项目设置中维护。

**下一次 Git 部署前，必须将 Vercel 项目的 Root Directory 从 `web` 改为 `apps/web`。** 目录整理不自动修改 Vercel 远端设置，也不代表已经部署。Git 分支与自动生产部署的对应关系以 Vercel 项目的 Git 设置为准。

### Python Worker

Worker 从 Supabase 领取任务，并调用模型和分析工具。统一从仓库根目录启动：

```bash
cd /data/syh/NP-Master-web
set -a && source backend/runtime.env && set +a
.local/venv/bin/python -m backend.worker
```

`backend/systemd/npmaster-worker.service` 是服务单元模板。安装或修改服务单元后，需要在目标主机重新加载并重启对应服务；仅编辑仓库文件不会改变已经运行的进程。

### 运维采集与妙搭

采集进程每 30 秒读取任务、Worker、GPU 和模型心跳，并更新 `public.ops_snapshots`：

```bash
cd /data/syh/NP-Master-web
set -a && source backend/runtime.env && set +a
.local/venv/bin/python -m backend.ops_monitor
```

妙搭应用是独立 Git 仓库，不应作为主仓库的普通子目录提交：

- 本地路径：`apps/genomine-ops-monitor/`
- 应用 ID：`app_17h1zuwp6t3`
- 线上地址：`https://udtkdfu8mk.feishu.link/app/app_17h1zuwp6t3`
- 可见范围：所有人可见，需要飞书登录

妙搭服务端使用 Supabase service role key 读取监控数据。凭据只配置在服务端环境，不写入源码或前端公共变量。

## 环境文件

| 文件 | 用途 | Git 管理 |
| --- | --- | --- |
| `.env.example` | 可共享的变量模板 | 是 |
| `apps/web/.env.local` | 主网站本地环境 | 否 |
| `backend/.env` | Worker 和采集进程密钥 | 否 |
| `backend/runtime.env` | 非敏感生产数据路径 | 是 |
| Vercel 环境变量 | 主网站构建和线上运行 | 在 Vercel 中维护 |
| 妙搭环境变量 | 妙搭服务端 Supabase 访问 | 在妙搭中维护 |

systemd 先加载 `backend/.env`，再加载 `backend/runtime.env`，确保生产路径以统一配置为准。轮换 service role key 时，需要同步更新 Worker、Vercel 服务端变量和妙搭服务端变量。

## 数据目录边界

| 路径 | 内容 | 清理原则 |
| --- | --- | --- |
| `runtime/cache/features/` | 可复用的模型特征 | 不是普通临时文件；按命中率和保留策略清理 |
| `runtime/cache/results/` | 任务分析结果 | 确认数据库记录和 Supabase Storage 后按保留期处理 |
| `runtime/cache/inputs/` | 下载或准备的输入 | 不能删除进行中任务的输入 |
| `runtime/cache/probs/` | 模型概率输出 | 可再生成，但清理会影响重跑和调试 |
| `runtime/cache/model_daemons/` | 模型进程心跳和状态 | 运行时依赖，不清理 |
| `runtime/cache/ops/` | 运维告警状态 | 运行时依赖，不清理 |
| `runtime/data/pfam/`、`runtime/data/mibig/` | 注释数据库 | 生产依赖，不按缓存处理 |
| `.local/archive/` | 历史实验、源码快照和旧输出 | 可转移到外部备份存储 |

`.local/` 集中存放维护工具、Python 虚拟环境和本地归档，不参与网站构建，也不纳入 Git。根目录不保留旧 `serve`、`cache`、`data` 或 `.venv-serve` 兼容路径。

## 数据库变更

迁移文件位于 `infra/supabase/migrations/`，按编号顺序管理。当前远端迁移历史与本地目录并非完全同步，因此不要直接执行 `supabase db push`。变更前先核对远端结构，再单独执行经过审核的迁移并验证结果。

## 提交与验证

功能修改、目录整理和文档调整应使用独立、可审查的提交。提交前至少运行：

```bash
.local/venv/bin/python -m pytest backend/tests
cd apps/web && npm run lint && npm run typecheck && npm run build
```

涉及妙搭时，还需在其独立仓库运行类型检查、ESLint 和生产构建。仅提交到本地 Git 不代表已经部署到 Vercel 或发布到妙搭。
