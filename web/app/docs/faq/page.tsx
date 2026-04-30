export default function FaqPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">常见问题</h1>
      <div className="space-y-4">
        {QA.map((qa, i) => (
          <details key={i} className="group rounded-lg border border-slate-200 bg-white p-4 open:bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900 dark:open:bg-slate-900/70">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
              <span>{qa.q}</span>
              <span className="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {qa.a}
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}

const QA = [
  {
    q: "为什么我的基因组没出区域？",
    a: (
      <>
        几种可能：(1) 基因组真的不含 BGC（一些寡 secondary metabolite 的属类）；(2) 阈值太严，建议切到“高召回”预设重提；
        (3) FASTA 太碎，windows &lt; 100 ACGT 都被跳过，看 contig 长度分布是否正常；
        (4) 基因组中含大量 N，模型对低质区域置信度低。
      </>
    ),
  },
  {
    q: "阈值怎么选？",
    a: (
      <>
        默认 0.50 是 OER metagenome 上经过 ~170 个湿实验验证的操作点；
        想找漏掉的远缘簇用 0.30；想做精挑细选喂给湿实验用 0.70。
        不同阈值影响召回 / 精度 trade-off，类型分类结果不变。
      </>
    ),
  },
  {
    q: "类型分类的 7 类怎么解读？",
    a: (
      <>
        与 antiSMASH 主类对齐：NRP（非核糖体肽）/ Polyketide（聚酮）/ Terpene（萜类）/ RiPP（核糖体肽）/
        Alkaloid（生物碱）/ Saccharide（糖类）/ Other（混合或未确定）。
        每个区域的 type_score 是该类二分类 LR 的 max-pool 概率，&gt; 0.95 视为高置信。
        细分类（PKS-I/II/III、RiPP 子类如 lasso/lanthi）在路线图里。
      </>
    ),
  },
  {
    q: "结果保存多久？",
    a: <>FASTA 7 天，结果文件（CSV/BED/FAI）30 天，区域数据库行永久保留。匿名用户的访问通过浏览器 localStorage 中的 client_id 持久化。</>,
  },
  {
    q: "可以批量提交吗？",
    a: <>web UI 单次单文件。批量请用 REST API（见 <a className="text-indigo-600 hover:underline dark:text-indigo-400" href="/docs/api">API 文档</a>），匿名用户 3 个并发上限，登录用户也是 3 个。</>,
  },
  {
    q: "支持真菌 / 植物吗？",
    a: <>暂不支持。Evo2 训练数据以原核为主，对真核基因组性能未知。真菌专门模型在路线图里（P3）。</>,
  },
  {
    q: "和 antiSMASH 的关系？",
    a: <>NP-Master 目标是做替代级产品。当前对齐 antiSMASH 的核心能力（区域检测 + 类型分类 + 标准格式输出），下游注释（Pfam / smCOG / NRPS-PKS 模块图 / 化学结构）按 P1 路线图陆续上。差异化体现在新颖簇召回、本土访问、原生中文体验三处。</>,
  },
] as const;
