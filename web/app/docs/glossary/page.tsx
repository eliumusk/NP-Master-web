export default function GlossaryPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">术语表</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        NP-Master 文档中出现的核心生物 / 计算术语。术语保留英文原文，解释为中文。
      </p>
      <dl className="space-y-5">
        {TERMS.map((t) => (
          <div key={t.term} className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
            <dt className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.term}
              {t.full && <span className="ml-2 text-xs font-normal text-slate-500">{t.full}</span>}
            </dt>
            <dd className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{t.def}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

const TERMS = [
  { term: "BGC", full: "Biosynthetic Gene Cluster", def: "生物合成基因簇。在基因组上空间共定位、协同表达、共同合成一个次级代谢产物的一组基因。" },
  { term: "NRPS", full: "Non-Ribosomal Peptide Synthetase", def: "非核糖体肽合成酶。模块化大酶，逐一加入氨基酸 / 类似单体合成肽链。代表产物：青霉素、万古霉素、依替米星。" },
  { term: "PKS", full: "Polyketide Synthase", def: "聚酮合成酶。逐步缩合丙二酰 CoA 单体，合成聚酮主链。分 type I (模块化) / II (迭代) / III (单体酶)。代表产物：红霉素、放线菌素、阿霉素。" },
  { term: "RiPP", full: "Ribosomally synthesized and Post-translationally modified Peptide", def: "核糖体合成、翻译后修饰肽。先经核糖体翻译出前体肽，再被各类修饰酶剪切、环化、糖基化等。包括 lanthipeptide / lasso peptide / sactipeptide 等亚型。" },
  { term: "Terpene", def: "萜类。由 C5 isoprene 单体衍生的天然产物，包括单萜、倍半萜、二萜、三萜。" },
  { term: "Alkaloid", def: "生物碱。含氮有机碱，常以氨基酸为前体。如阿托品、可卡因。" },
  { term: "Saccharide", def: "糖类天然产物。包括氨基糖苷类抗生素等。" },
  { term: "MIBiG", full: "Minimum Information about a Biosynthetic Gene cluster", def: "已知 BGC 的标准化数据库。本项目下游比对的目标库，4.0 版包含 ~3 000 个手工注释簇。" },
  { term: "antiSMASH", def: "BGC 检测与注释的事实工业标准。基于 HMM + 规则。NP-Master 的对标对象，目标是逐步替代。" },
  { term: "Pfam", def: "蛋白家族 HMM 数据库。下游 CDS 注释用。" },
  { term: "smCOG", full: "Secondary Metabolite Clusters of Orthologous Groups", def: "antiSMASH 内置的次级代谢专用同源簇分类，比 Pfam 更针对 BGC。" },
  { term: "Evo2", def: "DNA 序列基础模型，7B 参数，本项目用作冻结特征骨干。" },
  { term: "U-Net", def: "1D 卷积编码-解码网络。本项目检测头，~150K 参数，weak-negative BCE 训练。" },
  { term: "weak-negative BCE", def: "训练损失：正样本是 antiSMASH 标注的 BGC 区域，负样本是同基因组非 BGC 区域按长度 5× 抽样。" },
  { term: "stride / window", def: "滑窗参数。NP-Master 用 window=8192 bp、stride=2048 bp，每个窗口在 Evo2 上前向一次。" },
  { term: "sigmoid threshold", def: "U-Net 输出每 token 的 sigmoid 概率，超过阈值 + 长度 ≥ min_len_bp 的连续段视为一个区域。" },
] as const;
