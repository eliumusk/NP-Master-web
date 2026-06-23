import { getOptionalUser } from "@/lib/supabase/server";
import { BatchSubmit } from "@/components/BatchSubmit";

export default async function HomePage() {
  const user = await getOptionalUser();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium text-brand">BGCMaster 分析流程</p>
          <h1 className="max-w-3xl text-3xl font-semibold sm:text-4xl">
            面向细菌基因组的 BGC 区域检测、类型分类与安全分级。
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-fg-muted">
            上传 FASTA 后，系统会在同一个任务中运行 Evo2 U-Net 区域检测、
            RandomForest 产物类型分类、MIBiG 近邻比对、扩展 CDS 提取和 Pfam 注释。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="区域检测" value="U-Net" detail="ALT_OP 0.95 / 0.80" />
          <Stat label="类型分类" value="RF" detail="Pfam 结构域特征头" />
          <Stat label="结果导出" value="批处理" detail="区域、CDS、Pfam、轨道文件" />
        </div>
      </section>

      <aside className="lg:sticky lg:top-6">
        <BatchSubmit isLoggedIn={!!user} compact />
      </aside>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-fg-muted">{detail}</div>
    </div>
  );
}
