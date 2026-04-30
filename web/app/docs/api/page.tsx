export default function ApiDocsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">REST API</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          NP-Master 的程序化接口。当前支持匿名提交（按 client_id 跟踪）+ 任务查询。
          认证版（API key）在路线图里。
        </p>
      </header>

      <Section title="基础信息">
        <ul className="list-disc pl-5 text-sm">
          <li>Base URL: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">https://np-master-web.vercel.app/api/v1</code></li>
          <li>所有响应均为 JSON，UTF-8</li>
          <li>请求体大小限制：JSON 1 MB；文件上传走签名 PUT URL，不占 API 配额</li>
          <li>速率限制：每 client_id 最多 3 个并发任务（queued + running）</li>
        </ul>
      </Section>

      <Section title="POST /api/v1/jobs — 创建任务">
        <p className="text-sm">两步流程：先 POST 元数据拿签名 URL，再 PUT FASTA 到签名 URL。</p>
        <CodeBlock language="bash" code={`# 1. 预先在浏览器或 sha256sum 计算文件 sha
SHA=$(sha256sum genome.fna | awk '{print $1}')
SIZE=$(stat -c %s genome.fna)
CLIENT_ID=$(uuidgen)

# 2. 创建任务（匿名）
RESP=$(curl -sX POST https://np-master-web.vercel.app/api/v1/jobs \\
  -H "content-type: application/json" \\
  -d "{
    \\"filename\\": \\"genome.fna\\",
    \\"sha256\\": \\"$SHA\\",
    \\"bytes\\": $SIZE,
    \\"threshold\\": 0.5,
    \\"minLenBp\\": 2000,
    \\"clientId\\": \\"$CLIENT_ID\\"
  }")
JOB_ID=$(echo "$RESP" | jq -r .jobId)
UPLOAD_URL=$(echo "$RESP" | jq -r .uploadUrl)

# 3. 上传 FASTA
curl -X PUT "$UPLOAD_URL" \\
  -H "content-type: text/plain" \\
  --data-binary @genome.fna

# 4. 轮询状态（每 30 秒）
while true; do
  STATE=$(curl -s "https://np-master-web.vercel.app/api/v1/jobs/$JOB_ID" \\
    -H "x-client-id: $CLIENT_ID" | jq -r .status)
  echo "$JOB_ID -> $STATE"
  [ "$STATE" = "done" ] || [ "$STATE" = "failed" ] && break
  sleep 30
done

# 5. 拿区域结果
curl -s "https://np-master-web.vercel.app/api/v1/jobs/$JOB_ID/regions" \\
  -H "x-client-id: $CLIENT_ID" | jq .`} />
      </Section>

      <Section title="GET /api/v1/jobs/{id} — 任务状态">
        <p className="text-sm">需要把 client_id 通过 <code>x-client-id</code> header 或 cookie 传入；example 任务任何人可访问。</p>
        <CodeBlock language="json" code={`{
  "id": "59327055-15a7-42e0-9610-c04bafcb3b27",
  "status": "done",
  "fasta_sha256": "4a03d3d4...",
  "fasta_bytes": 6884352,
  "threshold": 0.5,
  "min_len_bp": 2000,
  "n_regions": 32,
  "created_at": "2026-04-30T15:46:57Z",
  "finished_at": "2026-04-30T16:09:34Z"
}`} />
      </Section>

      <Section title="GET /api/v1/jobs/{id}/regions — 区域列表">
        <CodeBlock language="json" code={`{
  "regions": [
    {
      "contig": "DS999645.1",
      "start": 124928,
      "end":   266240,
      "score": 0.975,
      "type":  "NRP",
      "type_score": 1.000
    },
    ...
  ]
}`} />
      </Section>

      <Section title="Python 客户端示例">
        <CodeBlock language="python" code={`import hashlib, requests, time, uuid

BASE = "https://np-master-web.vercel.app/api/v1"
CLIENT_ID = str(uuid.uuid4())
fasta = open("genome.fna", "rb").read()
sha = hashlib.sha256(fasta).hexdigest()

# 1. create
r = requests.post(f"{BASE}/jobs", json={
    "filename": "genome.fna",
    "sha256": sha, "bytes": len(fasta),
    "threshold": 0.5, "minLenBp": 2000,
    "clientId": CLIENT_ID,
})
r.raise_for_status()
job_id = r.json()["jobId"]
upload_url = r.json()["uploadUrl"]

# 2. upload
requests.put(upload_url, data=fasta, headers={"content-type": "text/plain"}).raise_for_status()

# 3. poll
while True:
    s = requests.get(f"{BASE}/jobs/{job_id}", headers={"x-client-id": CLIENT_ID}).json()
    print(job_id, "->", s["status"])
    if s["status"] in ("done", "failed"): break
    time.sleep(30)

# 4. results
regs = requests.get(f"{BASE}/jobs/{job_id}/regions", headers={"x-client-id": CLIENT_ID}).json()["regions"]
print(f"got {len(regs)} regions")`} />
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-slate-200 pb-2 text-xl font-bold tracking-tight dark:border-slate-800">{title}</h2>
      <div className="space-y-3 text-slate-700 dark:text-slate-300">{children}</div>
    </section>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <span>{language}</span>
      </div>
      <pre className="overflow-x-auto bg-slate-50 p-4 text-xs leading-relaxed dark:bg-slate-900">
        <code>{code}</code>
      </pre>
    </div>
  );
}
