import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LandingSubmit } from "@/components/LandingSubmit";
import { PipelineDiagram } from "@/components/PipelineDiagram";

const EXAMPLE_JOB_ID = process.env.NEXT_PUBLIC_EXAMPLE_JOB_ID || "";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div className="space-y-section">
      {/* ─── Hero (left text · right inline submit) ─── */}
      <section className="grid items-start gap-10 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6 pt-6">
          <div className="inline-flex items-center gap-2 rounded-pill border border-border bg-elevated px-3 py-1 text-xs font-medium text-fg-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-pill bg-brand" />
            Powered by Evo2 7B · 16-GPU 并行 · MIBiG 4.0
          </div>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            从基因组到 BGC，<br className="hidden sm:block" />
            一站式发现与注释。
          </h1>
          <p className="max-w-xl text-balance text-lg text-fg-muted">
            基于基因组语言模型的下一代 BGC 发现平台。上传细菌基因组 FASTA，几分钟内得到候选区域、产物类型、与 MIBiG 已知簇的最近邻比对，以及 IGV 可视化结果。
          </p>
          {EXAMPLE_JOB_ID && (
            <div className="text-sm">
              <Link href={`/jobs/${EXAMPLE_JOB_ID}`} className="font-medium text-fg-muted transition-colors hover:text-fg">
                没有 FASTA？查看示例结果 →
              </Link>
            </div>
          )}
        </div>

        {/* Right column: inline submit */}
        <div className="lg:sticky lg:top-20">
          <LandingSubmit isLoggedIn={isLoggedIn} />
        </div>
      </section>

      {/* ─── Stats ─── */}
      <section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="并行加速" value="14×"     hint="单卡 30 分钟 → 16 卡 2 分钟" />
          <Stat label="OER 召回" value="57%"     hint="antiSMASH 漏检候选簇召回率" />
          <Stat label="BGC 类别" value="7"       hint="NRP · Polyketide · Terpene · RiPP · Alkaloid · Saccharide · Other" />
          <Stat label="单次上限" value="50 MB"   hint="覆盖完整 Streptomyces 基因组" />
        </div>
      </section>

      {/* ─── Pipeline schematic + workflow ─── */}
      <section className="grid items-center gap-8 lg:grid-cols-[5fr_4fr]">
        <div className="space-y-6">
          <h2 className="text-3xl font-bold tracking-tight">三步出结果</h2>
          <p className="text-sm text-fg-muted">
            首次冷启动 5 分钟以内，重复同一基因组（缓存命中）30 秒。
          </p>
          <ol className="space-y-5">
            <Step n="1" title="上传 FASTA">支持 .fasta / .fna / .fa，或直接输入 NCBI accession。匿名也可提交。</Step>
            <Step n="2" title="GPU 并行分析">16 张 A800 并行抽 Evo2 7B 特征 · 1D U-Net 检测 · LR 头 7 类分类 · DIAMOND 比对 MIBiG 4.0。</Step>
            <Step n="3" title="交互式可视化">区域表 · IGV 浏览器 · CSV / BED / GenBank / FASTA / Score Track 一键下载。</Step>
          </ol>
        </div>
        <PipelineDiagram className="h-auto w-full text-fg drop-shadow-sm" />
      </section>

      {/* ─── 折叠技术细节 ─── */}
      <section>
        <details className="group rounded-card border border-border bg-elevated/40 p-6 open:bg-elevated/70">
          <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold">
            <span>底层工作原理</span>
            <span className="text-sm text-fg-muted transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-5 grid gap-4 text-sm text-fg-muted sm:grid-cols-2">
            <Cell title="特征抽取">
              FASTA 切成 8 192 bp 重叠窗口（stride 2 048），冻结 Evo2 7B 取 <code className="rounded bg-elevated px-1 py-0.5 text-xs">blocks.20.mlp.l3</code> 激活做 mean-pool。
            </Cell>
            <Cell title="区域检测">
              128 维投影 + 每窗口 1 024 token 喂 1D U-Net (~150K 参数, weak-negative BCE 训练)，输出 sigmoid，阈值 0.5 + 最小 2 kb 合并成区域。
            </Cell>
            <Cell title="类型分类">
              检测到的区域上 7 个二分类 LR (Alkaloid / Terpene / NRP / Polyketide / RiPP / Saccharide / Other)，max-pool 跨窗口取 argmax 给主类型 + top-2。
            </Cell>
            <Cell title="MIBiG 比对">
              区域 CDS 由 prodigal 调用 → DIAMOND blastp 跑 MIBiG 4.0（46 893 蛋白 / 2 636 BGC），返回 top-3 最相似已知簇。
            </Cell>
          </div>
        </details>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 transition-shadow hover:shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="numeric-display mt-3 text-5xl font-bold text-fg sm:text-6xl">{value}</div>
      <div className="mt-2 text-xs leading-relaxed text-fg-muted">{hint}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="numeric-display flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-sm font-semibold text-brand">
        {n}
      </div>
      <div>
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{children}</p>
      </div>
    </li>
  );
}

function Cell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 leading-relaxed">{children}</p>
    </div>
  );
}
