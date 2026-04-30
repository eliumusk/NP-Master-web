import Link from "next/link";

const EXAMPLE_JOB_ID = process.env.NEXT_PUBLIC_EXAMPLE_JOB_ID || "";

export default function Page() {
  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative space-y-6 py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Powered by Evo2 7B · 16-GPU 并行
          </div>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            从基因组到 BGC，<br className="hidden sm:block" />
            一站式发现与注释。
          </h1>
          <p className="max-w-2xl text-balance text-lg text-slate-600 dark:text-slate-400">
            基于基因组语言模型的下一代 BGC 发现平台。上传细菌基因组 FASTA，即可得到候选区域、产物类型、可视化结果与可下载的标准格式输出。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/submit"
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              提交一个基因组
              <ArrowRight />
            </Link>
            {EXAMPLE_JOB_ID && (
              <Link
                href={`/jobs/${EXAMPLE_JOB_ID}`}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                查看示例结果
              </Link>
            )}
            <Link
              href="/about"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              方法 & 评测 →
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="并行加速"
            value="14×"
            hint="单卡 30 分钟 → 16 卡 2 分钟"
            accent="indigo"
          />
          <Stat
            label="OER 召回"
            value="57%"
            hint="antiSMASH 漏检的候选簇召回率"
            accent="emerald"
          />
          <Stat
            label="BGC 类别"
            value="7"
            hint="NRP · Polyketide · Terpene · RiPP · Alkaloid · Saccharide · Other"
            accent="violet"
          />
          <Stat
            label="单次上限"
            value="50 MB"
            hint="覆盖完整 Streptomyces 基因组"
            accent="amber"
          />
        </div>
      </section>

      {/* Workflow */}
      <section className="space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">三步出结果</h2>
            <p className="mt-1 text-sm text-slate-500">
              从上传到可视化全程 5 分钟以内（首次冷启动），重复同一基因组 30 秒内出结果。
            </p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Step
            n="1"
            title="上传 FASTA"
            body="支持 .fasta / .fna / .fa，单文件 ≤ 50 MB。匿名访问也可提交，登录用户保留任务历史。"
          />
          <Step
            n="2"
            title="GPU 并行分析"
            body="后端 16 张 A800 并行抽 Evo2 7B 的特征，1D U-Net 给出 BGC 区域预测，LR 头给出 7 类产物概率。"
          />
          <Step
            n="3"
            title="交互式可视化"
            body="区域表格 + 内嵌 IGV 浏览器按类型上色，CSV / BED / FASTA 一键下载，IGV 也可单独打开。"
          />
        </div>
      </section>

      {/* How it works (technical detail, collapsible) */}
      <section>
        <details className="group rounded-lg border border-slate-200 bg-slate-50/50 p-6 open:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 dark:open:bg-slate-900/70">
          <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold">
            <span>底层工作原理</span>
            <span className="text-sm text-slate-500 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 dark:text-slate-400">
            <div>
              <h3 className="font-medium text-slate-900 dark:text-slate-100">特征抽取</h3>
              <p className="mt-1">FASTA 切成 8 192 bp 重叠窗口（stride 2 048），冻结的 Evo2 7B 走前向，取 <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-800">blocks.20.mlp.l3</code> 的激活做 mean-pool。</p>
            </div>
            <div>
              <h3 className="font-medium text-slate-900 dark:text-slate-100">区域检测</h3>
              <p className="mt-1">128 维投影 + 每窗口 1 024 个 token 喂 1D U-Net (~150K 参数, weak-negative BCE 训练)，输出 sigmoid，阈值 0.5 + 最小 2 kb 合并。</p>
            </div>
            <div>
              <h3 className="font-medium text-slate-900 dark:text-slate-100">类型分类</h3>
              <p className="mt-1">检测到的区域上 7 个二分类 LR (Alkaloid / Terpene / NRP / Polyketide / RiPP / Saccharide / Other)，max-pool 跨窗口取 argmax 给主类型 + top-2。</p>
            </div>
            <div>
              <h3 className="font-medium text-slate-900 dark:text-slate-100">可视化</h3>
              <p className="mt-1">导出 BED9 + samtools-faidx 索引，前端用 igv.js 加载用户基因组，按 BGC 类型 itemRgb 自动上色。</p>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

function Stat({ label, value, hint, accent }: {
  label: string; value: string; hint: string;
  accent: "indigo" | "emerald" | "violet" | "amber";
}) {
  const accents: Record<string, string> = {
    indigo: "from-indigo-50 to-indigo-100 text-indigo-700 dark:from-indigo-950/40 dark:to-indigo-900/30 dark:text-indigo-300",
    emerald: "from-emerald-50 to-emerald-100 text-emerald-700 dark:from-emerald-950/40 dark:to-emerald-900/30 dark:text-emerald-300",
    violet: "from-violet-50 to-violet-100 text-violet-700 dark:from-violet-950/40 dark:to-violet-900/30 dark:text-violet-300",
    amber: "from-amber-50 to-amber-100 text-amber-700 dark:from-amber-950/40 dark:to-amber-900/30 dark:text-amber-300",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className={`mb-3 inline-flex rounded-md bg-gradient-to-br px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${accents[accent]}`}>
        {label}
      </div>
      <div className="numeric-display text-4xl font-bold sm:text-5xl">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
        {n}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{body}</p>
    </div>
  );
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
