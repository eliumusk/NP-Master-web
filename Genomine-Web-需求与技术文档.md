# BGCMaster Web — 技术与需求文档

> 基于 NP-Master-web 架构扩展，覆盖完整批量分析流程

---

## 背景与差异

现有网站 **NP-Master-web** 的定位是：单个基因组 FASTA → BGC 检测 → 交互式可视化，面向外部用户。

本次要做的网站对应**最后一次完整批量分析流程**，流程更长，多了三个阶段：

- 检测后的区域筛选（Safe tier 过滤）
- 扩展区域 CDS 预测（Prodigal extended extraction）
- Pfam 功能域注释（hmmsearch）

---

## 一、功能需求

### 1.1 输入方式

| 方式 | 说明 |
|------|------|
| 批量 FASTA 上传 | 支持多个 `.fa/.fasta/.fna`，或打包 `.tar.gz` |
| 单个基因组 | 兼容原 NP-Master-web 的单文件模式 |
| NCBI Accession | 输入 accession 号自动拉取 FASTA（同现有网站） |

**用户可调参数**（否则使用以下默认值）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `threshold` | 0.95 | UNet 检测起始阈值 (ALT_OP) |
| `extend_threshold` | 0.80 | 区域延伸阈值 |
| `min_support_windows` | 3 | 最小支持窗口数 |
| `min_len_bp` | 2000 | 最短区域（bp） |
| `safe_tier_min` | Tier2 | 最低通过等级 |
| `extend_flank_bp` | 5000 | 区域扩展两侧 flank（bp） |

### 1.2 Pipeline 阶段

```
阶段 1  Evo2 embedding 提取
        └─ window=8192, stride=2048, layer=blocks.20.mlp.l3, dim=4096

阶段 2  UNet 推理 (128d projection)
        └─ ckpt: evo2_per_token_unet/full_weakneg_bce_w05_ddp4_gb64_seed0/best.pt

阶段 3  BGC 区域解码
        └─ ALT_OP: start=0.95, extend=0.80, min_windows=3

阶段 4  BGC 类型分类（7 类 LR）
        └─ Alkaloid / Terpene / NRP / Polyketide / RiPP / Saccharide / Other

阶段 5  MIBiG 4.0 最近邻比对（DIAMOND blastp）

阶段 6  Safe tier 筛选（新增）
        └─ Tier1~Tier5，输出 safe_pass 区域集

阶段 7  扩展区域 CDS 预测（新增）
        └─ Prodigal -p meta，flank=5 kb，输出 .faa/.fna/.csv

阶段 8  Pfam 域注释（新增）
        └─ hmmsearch vs Pfam-A.hmm，GA cutoff，48 threads
```

### 1.3 结果展示

**总览页**（per job）：
- 基本信息：基因组数、总区域数、safe pass 数、运行时长
- Safe tier 分布饼图（Tier1~Tier5）
- BGC 类型分布（7 类）
- 每个基因组的区域数 bar chart

**区域表**（可排序 / 过滤）：

| 列 | 说明 |
|----|------|
| genome | 基因组名 |
| contig | 序列名 |
| start / end | 区域坐标（bp） |
| length | 区域长度 |
| BGC type | 7 类之一 |
| score | UNet 置信分 |
| tier | Tier1~Tier5 |
| MIBiG top hit | 最近邻已知簇 |

点击行展开：IGV 可视化 + CDS Pfam 色块轨道 + Pfam 域注释明细表（domain、clan、E-value、坐标）

**下载**（per job，全量打包）：

| 文件 | 说明 |
|------|------|
| `regions.csv` | 完整区域表（含 tier、type、mibig、pfam 摘要） |
| `extended_cds.faa/fna/csv` | 扩展 CDS 序列 |
| `regions.gbk` | GenBank 格式 |
| `regions.bed` | BED 格式 |
| `scores.bedgraph` | IGV score track |
| `pfam.domtbl` | 原始 hmmsearch 输出 |

### 1.4 访问控制

与现有网站一致：

| 用户类型 | 权限 |
|----------|------|
| 匿名 | 最多 3 并发，限 10 MB/文件，**不支持批量提交** |
| 登录用户 | 任务历史保留、50 MB 单文件上限、**支持批量提交** |

---

## 二、技术架构

### 2.1 整体架构

继承 NP-Master-web 架构，不引入新的基础设施：

```
用户浏览器
    │  HTTPS
    ▼
Next.js 前端（Vercel 或自托管）
    │  Supabase JS SDK
    ▼
Supabase
  ├─ Auth（邮箱 + magic link）
  ├─ PostgreSQL（jobs / genomes / regions / pfam_hits 表）
  ├─ Storage（fasta-uploads / results buckets）
  └─ Realtime（前端订阅 job status）
    │  轮询 claim_next_job
    ▼
Python Worker（Voc_gpu_node7_a800）
    └─ serve/worker.py — 现有逻辑 + 新增三个阶段
```

**技术栈与现有网站完全一致**：

- 前端：Next.js 15 App Router + Tailwind CSS
- 后端：Python 3.11，supabase-py，现有 `.venv-serve`
- 数据库 / Auth / Storage：Supabase（现有项目可复用或新建）
- GPU worker：在现有 A800 上扩展，无需新机器

### 2.2 数据库 Schema

在现有表基础上扩展，**不破坏已有字段**：

```sql
-- jobs 表新增字段
ALTER TABLE jobs ADD COLUMN n_genomes          integer;
ALTER TABLE jobs ADD COLUMN safe_tier_min      text DEFAULT 'Tier2';
ALTER TABLE jobs ADD COLUMN extend_flank_bp    integer DEFAULT 5000;
ALTER TABLE jobs ADD COLUMN result_pfam_path   text;
ALTER TABLE jobs ADD COLUMN result_ext_csv_path text;
ALTER TABLE jobs ADD COLUMN result_ext_faa_path text;

-- 新增：一个 job 可包含多个基因组
CREATE TABLE genomes (
  id            bigserial PRIMARY KEY,
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  genome_name   text NOT NULL,
  fasta_sha256  text NOT NULL,
  n_regions     integer,
  n_safe        integer,
  status        text NOT NULL DEFAULT 'queued',
  started_at    timestamptz,
  finished_at   timestamptz
);

-- regions 表新增字段
ALTER TABLE regions ADD COLUMN genome_name text;
ALTER TABLE regions ADD COLUMN safe_tier   text;   -- Tier1~Tier5
ALTER TABLE regions ADD COLUMN ext_start   integer;
ALTER TABLE regions ADD COLUMN ext_end     integer;

-- 新增：Pfam 注释
CREATE TABLE pfam_hits (
  id          bigserial PRIMARY KEY,
  region_id   bigint NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  locus_tag   text NOT NULL,
  domain      text NOT NULL,
  clan        text,
  description text,
  e_value     real,
  hmm_start   integer,
  hmm_end     integer,
  seq_start   integer,
  seq_end     integer
);
CREATE INDEX pfam_hits_region_idx ON pfam_hits (region_id);
```

### 2.3 Worker 扩展

在现有 `pipeline.py` 的 `run_job()` 末尾追加三个阶段：

```python
# Stage 6: Safe tier filtering
_safe_filter(settings, csv_path, safe_csv_out,
             tier_min=job["safe_tier_min"])

# Stage 7: Extended region CDS extraction (Prodigal)
_extract_extended(settings, safe_csv_out, fasta_path,
                  ext_out_dir, flank_bp=job["extend_flank_bp"])

# Stage 8: Pfam annotation
_run_pfam(settings, ext_out_dir / "extended_cds.faa", pfam_out_dir)
```

每个 stage 完成后调用 `update_job(supa, job_id, log_tail=...)` 更新状态，前端实时可见进度。

**批量处理策略**：
- Evo2 extract 阶段：多基因组并发（现有 `run_parallel_extract` 已支持）
- infer / decode / classify：按序串行（GPU 资源限制）
- safe filter / Prodigal / Pfam：轻量，可多基因组并行

### 2.4 前端页面结构

```
/                    Landing（复用现有 Hero，改文案描述完整 pipeline）
/submit              提交（新增批量上传 UI，多文件 drag & drop）
/jobs                任务列表（同现有）
/jobs/[id]           任务详情（扩展现有 JobDetail）
  ├─ /overview       总览 + 统计图
  ├─ /regions        区域表（加 tier 列 + pfam 摘要）
  └─ /genome/[name]  单基因组 IGV 视图
/docs                文档（pipeline 说明、参数解释）
```

### 2.5 关键新组件

| 组件 | 功能 |
|------|------|
| `BatchUpload.tsx` | 多文件拖拽上传，逐文件进度条，sha256 去重 |
| `PipelineProgress.tsx` | 8 阶段进度条，实时订阅 `jobs.log_tail` |
| `SafeTierBadge.tsx` | Tier1~Tier5 色标 badge |
| `PfamTrack.tsx` | 区域内 CDS Pfam 域色块轨道（antiSMASH 风格） |
| `JobOverview.tsx` | 统计卡片 + 类型/tier 分布图（recharts） |

---

## 三、开发优先级

| 优先级 | 内容 | 工作量 |
|--------|------|--------|
| P0 | Worker 扩展（safe filter + Prodigal + Pfam 阶段） | 2 天 |
| P0 | DB schema 迁移 + `insert_pfam_hits` client 函数 | 0.5 天 |
| P1 | 前端：批量上传 UI + 多基因组进度显示 | 2 天 |
| P1 | 前端：JobOverview 统计页 + PfamTrack 组件 | 2 天 |
| P2 | Safe tier 过滤参数暴露给用户（UI 控件） | 0.5 天 |
| P2 | 批量结果打包下载（zip） | 1 天 |
| P3 | 文档页面（pipeline 原理、参数说明） | 1 天 |

**MVP（最小可用版本）**：P0 + P1，约 4.5 天可跑通完整批量流程并展示结果。

---

## 四、与现有网站的关系

两个网站可**共用一套代码库**，通过环境变量区分模式：

```env
PIPELINE_MODE=full    # 启用 safe filter + Prodigal + Pfam 阶段
PIPELINE_MODE=detect  # 仅检测（现有 NP-Master-web 行为）
```

现有 NP-Master-web 的单基因组快速检测功能不受影响，新批量 pipeline 作为增强模式叠加。

---

## 五、参考现有代码位置

| 参考对象 | 路径 |
|----------|------|
| 现有网站前端 | `/data/syh/NP-Master-web/web/` |
| Worker & Pipeline | `/data/syh/NP-Master-web/serve/` |
| Supabase migrations | `/data/syh/NP-Master-web/supabase/migrations/` |
| Safe tier 逻辑 | `/data/syh/bench_34/npmaster_out/safe_summary.json` |
| 扩展 CDS 提取脚本 | `/data/syh/extract_extended.py` |
| Pfam 注释脚本 | `/data/syh/NP-Master-web/serve/pfam.py` |
| 最近一次完整运行结果 | `/data/syh/only_ext_out/`、`/data/syh/pfam_anno/` |
