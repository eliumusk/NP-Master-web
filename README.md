# Genomine

Genomine 是一个从基因组 FASTA 到候选生物合成基因簇（BGC）检测、注释和可视化的分析平台。主网站、Python Worker、Supabase 和飞书妙搭监控按职责分层管理。

## 组成

```text
浏览器 → Next.js 主网站 → Supabase
                            ↓
                    Python Worker → GPU 模型与分析工具
                            ↓
                     运维快照 → 飞书妙搭监控
```

```text
apps/                       应用
  web/                      Next.js 15 主网站与 API 路由
  genomine-ops-monitor/     飞书妙搭监控（独立 Git 仓库）
backend/                    Python 后端包、脚本、测试和服务配置
infra/supabase/migrations/  数据库结构变更
runtime/                    本地生产数据，不纳入 Git
  cache/                    任务输入、特征、结果和进程状态
  data/                     Pfam、MIBiG 和分析工具数据
docs/                       需求、运行和部署文档
.local/                     本地工具、Python 环境和历史归档，不纳入 Git
```

`runtime/cache` 和 `runtime/data` 是生产依赖，不能随目录清理直接删除。更多运行路径、部署关系和数据保留规则见 [docs/operations.md](docs/operations.md)。原始需求设计保留在 [docs/requirements.md](docs/requirements.md)。

## 环境要求

- Python 3.11 或兼容的新版本
- 主网站：Node.js 20 或更高版本
- 妙搭应用：Node.js 22 或更高版本
- 生产 Worker 另需配置模型仓库、GPU 环境、Prodigal、DIAMOND、HMMER 和 Pfam/MIBiG 数据

主网站变量放在 `apps/web/.env.local`，Worker 密钥放在 `backend/.env`，非敏感生产路径放在 `backend/runtime.env`。service role key 只能用于服务端，不能放入 `NEXT_PUBLIC_*` 变量。`.env.example` 是不含可用凭据的变量模板。

## 本地启动

在主仓库根目录安装 Python 依赖：

```bash
python -m venv .local/venv
.local/venv/bin/pip install -r backend/requirements-dev.txt
```

加载生产路径后，启动 Worker 或运维快照采集：

```bash
set -a && source backend/runtime.env && set +a
.local/venv/bin/python -m backend.worker
.local/venv/bin/python -m backend.ops_monitor
```

主网站在独立目录启动：

```bash
cd apps/web
npm ci
npm run dev
```

妙搭应用的启动和发布方式见其独立仓库的 `apps/genomine-ops-monitor/README.md`。

## 检查

```bash
.local/venv/bin/python -m pytest backend/tests
cd apps/web && npm run lint && npm run typecheck && npm run build
```

修改妙搭应用时，在 `apps/genomine-ops-monitor/` 中使用 Node.js 22 运行：

```bash
npm run type:check
npm run eslint
npm run build:prod
```

## Git 与发布边界

- 主仓库：`https://github.com/eliumusk/NP-Master-web.git`
- 主网站：Vercel 项目 `np-master-web`，线上域名为 `https://www.genomine.bio`
- 下一次部署前，Vercel Root Directory 必须设置为 `apps/web`
- 妙搭应用：独立飞书 Git 仓库和独立发布流程
- 不提交密钥、Vercel 关联目录、依赖目录、构建产物、生产数据或本地归档
- 数据库变更通过经过审核的迁移执行；不要用本地迁移目录直接覆盖远端历史
