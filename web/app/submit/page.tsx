import { getOptionalUser } from "@/lib/supabase/server";
import { BatchSubmit } from "@/components/BatchSubmit";

export default async function SubmitPage() {
  const user = await getOptionalUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">提交基因组</h1>
        <p className="mt-1 text-sm text-fg-muted">
          登录用户可以提交批量 FASTA；匿名模式可提交一个小 FASTA 用于快速测试。
        </p>
      </div>
      <BatchSubmit isLoggedIn={!!user} />
    </div>
  );
}
