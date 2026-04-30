export default function QuickstartPage() {
  return (
    <article className="prose-doc mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">快速上手</h1>
      <p className="text-slate-600 dark:text-slate-400">5 分钟完成第一次 BGC 分析。</p>
      <ol className="space-y-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <Step n="1" title="准备 FASTA">
          单文件 ≤ 50 MB（匿名 25 MB，登录 50 MB），格式 .fasta / .fna / .fa。
          建议优先用单基因组 assembly，多基因组合并文件也能跑但延迟更长。
        </Step>
        <Step n="2" title="选择检测预设">
          <ul className="ml-5 list-disc">
            <li><b>高召回</b>：thr 0.30 / min 1 kb，找尽量多候选，假阳性较高</li>
            <li><b>平衡（推荐）</b>：thr 0.50 / min 2 kb，OER 上经过湿实验校准</li>
            <li><b>高精度</b>：thr 0.70 / min 4 kb，仅长片段 + 高置信</li>
          </ul>
          高级参数可单独调阈值与最小长度。
        </Step>
        <Step n="3" title="提交 & 等待">
          后端 16 张 A800 并行抽 Evo2 7B 特征 + 1D U-Net 检测 + LR 头分类。
          首次冷启动 4-5 分钟（Evo2 加载 60 s + 16 卡并行 ~2 min + 分类 5 s）。
          重复同一基因组（同 sha256）30 秒内出结果（缓存命中）。
        </Step>
        <Step n="4" title="阅读结果">
          <ul className="ml-5 list-disc">
            <li>区域表：按检测分数排序，每行有产物类型彩色徽章 + 类型置信度</li>
            <li>IGV 浏览器：自动定位到第一个区域，按类型上色，可拖动 / 缩放</li>
            <li>下载：CSV（含 v4_1_type / v4_1_type_score 列）/ BED9（itemRgb 着色）/ FASTA（用户原文件）</li>
          </ul>
        </Step>
        <Step n="5" title="下游分析">
          BED 文件可直接喂 IGV / UCSC / 其他基因组浏览器。
          NRPS / PKS 模块图、Pfam 域注释、化学结构推断在路线图（P1），后续会集成到结果页。
        </Step>
      </ol>
    </article>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
        {n}
      </div>
      <div className="flex-1 space-y-1.5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <div className="text-sm">{children}</div>
      </div>
    </li>
  );
}
