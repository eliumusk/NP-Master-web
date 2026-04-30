export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-section">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">关于 NP-Master</h1>
        <p className="text-base leading-relaxed text-fg-muted">
          NP-Master 是基于基因组语言模型 Evo2 的 BGC（生物合成基因簇）发现与注释平台。
          目标是做成中文世界里完整可用的 BGC 分析工具，在新颖簇发现、易用性、本土访问体验上提供差异化优势。
        </p>
      </header>

      <Section title="Model Card" id="model">
        <SubSection title="任务定义">
          <p>给定细菌基因组（多 contig FASTA），输出每个候选 BGC 的：</p>
          <ul>
            <li>位置（contig + start + end，单位 bp）</li>
            <li>检测得分（每个区域内 per-token sigmoid 的均值）</li>
            <li>产物类型（7 类：NRP / Polyketide / Terpene / RiPP / Alkaloid / Saccharide / Other）+ top-2 概率</li>
            <li>MIBiG 4.0 已知簇 top-3 最近邻（DIAMOND blastp · 46 893 蛋白库）</li>
          </ul>
        </SubSection>

        <SubSection title="模型架构">
          <ul>
            <li><b>骨干</b>：Evo2 7B（冻结），取 <code>blocks.20.mlp.l3</code> 层激活</li>
            <li><b>窗口</b>：8 192 bp，stride 2 048 bp，每个窗口 1 024 个 latent token</li>
            <li><b>检测头</b>：1D U-Net，~150K 参数，weak-negative BCE 训练</li>
            <li><b>分类头</b>：7 个二分类逻辑回归，输入 mean-pool 4 096-dim Evo2 hidden states</li>
          </ul>
        </SubSection>

        <SubSection title="训练数据">
          <ul>
            <li>正样本：MIBiG 4.0 与 antiSMASH 注释一致的 BGC 区域，覆盖 ~2 000 个细菌基因组</li>
            <li>弱负样本：同一基因组中非 BGC 区域，按 region 长度 5× 抽样</li>
            <li>数据集划分按基因组 ID（避免跨基因组泄漏）</li>
          </ul>
        </SubSection>

        <SubSection title="评测">
          <ul>
            <li><b>9-genome held-out</b>：F1 ≈ 0.51（threshold 0.7, min 8 kb）</li>
            <li><b>OER004256 metagenome</b>：召回 antiSMASH 漏检候选 0.5703，171 个一线湿实验 PASS</li>
            <li>详细 PR/ROC 曲线 & 按类别分组的 recall 见 [<span className="italic">paper-supplement (TBD)</span>]</li>
          </ul>
          <p className="text-xs text-fg-subtle">
            基线对比（antiSMASH 7.0 / DeepBGC / GECCO / ClusterFinder）的统一测试集结果将随论文发布。
          </p>
        </SubSection>

        <SubSection title="局限性 (Limitations)">
          <ul>
            <li>U-Net 主线在 9-genome 上的阈值是事后选取的，对该 benchmark 不构成正式声明；OER 上有正式预注册阈值</li>
            <li>覆盖范围限于细菌；真菌 / 植物模型在 P3 路线图里</li>
            <li>当前下游注释只到 prodigal CDS，Pfam / smCOG / NRPS-PKS 模块图仍在 P1 路线图</li>
            <li>训练数据基于 antiSMASH 标签，对该工具未召回的真新颖簇仍可能漏检</li>
          </ul>
        </SubSection>

        <SubSection title="可复现性 (Reproducibility)">
          <ul>
            <li>检测 checkpoint：<code>experiments/evo2_per_token_unet/train_runs/full_weakneg_bce_w05_ddp4_gb64_seed0/best.pt</code></li>
            <li>分类 checkpoint：<code>data/evo2_lr_multiscale/type_lr/lr_type_*.npz</code></li>
            <li>MIBiG DB：4.0（46 893 蛋白 / 2 636 BGCs，DIAMOND v2.1.x）</li>
            <li>Git commit + Zenodo DOI 将随论文释出</li>
          </ul>
        </SubSection>
      </Section>

      <Section title="路线图" id="roadmap">
        <p>NP-Master 的目标是在功能上对齐并最终替代 antiSMASH。当前进度与下一步：</p>
        <ul>
          <li>✅ BGC 区域检测 + 7 类产物分类（已上线）</li>
          <li>✅ 16 GPU 并行加速（30 min → 2 min）</li>
          <li>✅ MIBiG 最近邻比对 + 已知簇关联</li>
          <li>✅ NCBI accession 直接拉取</li>
          <li>✅ GenBank 输出（含 prodigal CDS）</li>
          <li>✅ IGV per-bp 分数 track</li>
          <li>✅ REST API + 程序访问</li>
          <li>🚧 邮件通知（等 SMTP 通道）</li>
          <li>🚧 完整下游注释（Pfam / smCOG / NRPS-PKS 模块图）</li>
          <li>🚧 化学结构推断（NRPS/PKS → SMILES）</li>
          <li>🚧 BGC 类型细分类（PKS-I/II/III, RiPP 子类）</li>
          <li>🚧 真菌 / 植物基因组支持</li>
        </ul>
      </Section>

      <Section title="引用" id="cite">
        <p>论文准备中。如需在工作中引用 NP-Master，请暂引用：</p>
        <pre className="overflow-x-auto rounded-card bg-elevated p-4 text-xs leading-relaxed">
{`@misc{npmaster2026,
  title  = {NP-Master: Genome Language Model–based BGC Discovery},
  author = {Sun, Yuhong et al.},
  year   = {2026},
  note   = {https://np-master-web.vercel.app},
}`}
        </pre>
      </Section>

      <Section title="数据保留 & 隐私" id="privacy">
        <ul>
          <li>上传的 FASTA：7 天后自动删除</li>
          <li>结果 CSV / BED / GenBank / FAI / FASTA / bedgraph：30 天后自动删除</li>
          <li>区域行（数据库）：永久保留，匿名访问受 client_id 隔离</li>
          <li>不会用上传内容训练模型</li>
        </ul>
      </Section>

      <Section title="License" id="license">
        <p>代码：MIT License。模型权重：CC-BY 4.0（学术使用）。</p>
        <p className="text-xs text-fg-subtle">
          MIBiG 数据来自 <a className="text-brand hover:underline" href="https://mibig.secondarymetabolites.org/" target="_blank" rel="noreferrer">mibig.secondarymetabolites.org</a>（CC-BY 4.0）。
        </p>
      </Section>

      <Section title="联系" id="contact">
        <p>问题或反馈请提 <a className="text-brand hover:underline" href="https://github.com/Sophia-YH/NP-Master-web/issues" target="_blank" rel="noreferrer">GitHub Issue</a> 或邮件至 <code>sunyuhong@sjtu.edu.cn</code>。</p>
      </Section>
    </article>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-20">
      <h2 className="border-b border-border pb-2 text-2xl font-bold tracking-tight">
        {title}
      </h2>
      <div className="space-y-4 text-sm leading-relaxed text-fg [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {children}
    </div>
  );
}
