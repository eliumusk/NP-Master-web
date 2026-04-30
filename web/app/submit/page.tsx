import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SubmitForm } from "@/components/SubmitForm";

export default async function SubmitPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">提交基因组分析</h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          上传细菌基因组 FASTA，几分钟内得到 BGC 候选区域、产物类型与可视化结果。
          {!isLoggedIn && (
            <> 匿名也可提交（每浏览器最多 3 个并发任务），<Link className="text-brand underline-offset-2 hover:underline" href="/login?next=/submit">登录</Link>后任务会保留在历史里、上限提升至 50 MB。</>
          )}
        </p>
      </div>
      <SubmitForm isLoggedIn={isLoggedIn} />
    </div>
  );
}
