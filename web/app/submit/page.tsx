import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitForm } from "@/components/SubmitForm";

export default async function SubmitPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/submit");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Submit a genome</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Upload a bacterial genome FASTA (≤ 10 MB). One job runs at a time per GPU; you may have
        up to 3 active jobs.
      </p>
      <SubmitForm />
    </div>
  );
}
