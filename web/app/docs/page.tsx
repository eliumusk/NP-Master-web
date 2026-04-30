import Link from "next/link";

export default function DocsIndexPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">文档</h1>
        <p className="text-base text-slate-600 dark:text-slate-400">
          NP-Master 使用指南、术语表与 API 参考。
        </p>
      </header>

      <Card title="快速上手" body="从上传 FASTA 到拿到 BGC 区域，5 分钟完整流程。" href="/docs/quickstart" />
      <Card title="常见问题 (FAQ)" body="如何选择阈值、为什么我的基因组没出区域、如何解读类型概率。" href="/docs/faq" />
      <Card title="术语表" body="BGC、NRPS、PKS、RiPP、MIBiG、Pfam 等核心术语解释。" href="/docs/glossary" />
      <Card title="REST API" body="用 curl / Python 调用 NP-Master 的程序化接口。" href="/docs/api" />
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{body}</p>
      <div className="mt-3 text-sm text-indigo-600 dark:text-indigo-400">阅读 →</div>
    </Link>
  );
}
