import type { SupabaseClient } from "@supabase/supabase-js";

type Job = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat: string | null;
  log_tail: string | null;
  error: string | null;
  n_genomes: number;
  n_regions: number;
};

type ModelMetric = {
  gpu: number;
  healthy: boolean;
  reason: string;
  memory_used_mib?: number;
  memory_total_mib?: number;
  utilization_percent?: number;
  temperature_c?: number;
  progress?: { windows_done: number; win_per_sec: number; age_seconds: number } | null;
};

type Snapshot = {
  updated_at: string;
  metrics: {
    collected_at: string;
    worker?: { process_alive: boolean };
    jobs?: {
      counts: { awaiting_upload: number; queued: number; running: number; done_24h: number; failed_24h: number };
      running: Array<{ id: string; log_tail: string }>;
      oldest_queued_seconds: number | null;
      average_done_duration_seconds: number | null;
    } | null;
    models?: ModelMetric[];
    model_healthy_count: number;
    model_configured_count: number;
    total_win_per_sec: number;
  };
};

const JOB_FIELDS = "id,title,status,created_at,started_at,finished_at,last_heartbeat,log_tail,error,n_genomes,n_regions";
const HELP = "可用命令：\n状态 — 队列、任务和整体健康\n排队 — 当前排队与运行任务\n模型 — 各 GPU 和模型状态\n任务 <ID> — 查询完整或前 8 位任务 ID";

function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "未知";
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${Math.floor(value / 3600)} 小时 ${Math.floor((value % 3600) / 60)} 分`;
}

function ageSeconds(timestamp: string) {
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000);
}

async function latestSnapshot(admin: SupabaseClient): Promise<Snapshot | null> {
  const { data, error } = await admin.from("ops_snapshots").select("updated_at,metrics")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`读取运维快照失败：${error.message}`);
  return data as Snapshot | null;
}

function snapshotWarning(snapshot: Snapshot | null) {
  if (!snapshot) return "监控快照尚未上报，模型数据暂不可用。";
  const age = ageSeconds(snapshot.updated_at);
  return age > 120 ? `监控数据已过期（${duration(age)}前更新），以下模型信息仅供参考。` : "";
}

function statusText(snapshot: Snapshot | null) {
  if (!snapshot) return snapshotWarning(null);
  const metrics = snapshot.metrics;
  const jobs = metrics.jobs;
  const jobText = jobs
    ? `排队 **${jobs.counts.queued}**，等待上传 **${jobs.counts.awaiting_upload}**，运行 **${jobs.counts.running}**\n近 24 小时：完成 **${jobs.counts.done_24h}**，失败 **${jobs.counts.failed_24h}**`
    : "任务指标暂不可用";
  const running = jobs?.running[0];
  const lines = [
    jobText,
    running ? `当前任务：\`${running.id.slice(0, 8)}\`，阶段：${running.log_tail || "处理中"}` : "当前没有运行中的任务",
    `模型健康：**${metrics.model_healthy_count}/${metrics.model_configured_count}**；Worker：${metrics.worker?.process_alive ? "在线" : "离线"}`,
    `当前提取速度：**${metrics.total_win_per_sec.toFixed(2)} windows/s**`,
    `采集时间：${metrics.collected_at}`,
  ];
  const warning = snapshotWarning(snapshot);
  return [warning, ...lines].filter(Boolean).join("\n");
}

async function queueText(admin: SupabaseClient) {
  const { data, error } = await admin.from("jobs").select(JOB_FIELDS)
    .in("status", ["awaiting_upload", "queued", "running"]).order("created_at", { ascending: true }).limit(100);
  if (error) throw new Error(`读取队列失败：${error.message}`);
  const jobs = (data ?? []) as Job[];
  const queued = jobs.filter((job) => job.status === "queued");
  const running = jobs.filter((job) => job.status === "running");
  const awaiting = jobs.filter((job) => job.status === "awaiting_upload").length;
  const lines = [`排队 **${queued.length}**，运行 **${running.length}**，等待上传 **${awaiting}**`];
  for (const job of running) {
    lines.push(`运行中 \`${job.id.slice(0, 8)}\`：${job.log_tail || "处理中"}（${duration(ageSeconds(job.started_at ?? job.created_at))}）`);
  }
  for (const job of queued.slice(0, 10)) {
    lines.push(`排队 \`${job.id.slice(0, 8)}\`：已等待 ${duration(ageSeconds(job.created_at))}`);
  }
  if (queued.length > 10) lines.push(`另有 ${queued.length - 10} 个排队任务未显示`);
  if (!jobs.length) lines.push("当前没有等待或运行中的任务");
  return lines.join("\n");
}

function modelText(snapshot: Snapshot | null) {
  if (!snapshot) return snapshotWarning(null);
  const metrics = snapshot.metrics;
  const lines = [
    snapshotWarning(snapshot),
    `模型健康：**${metrics.model_healthy_count}/${metrics.model_configured_count}**；总速度：**${metrics.total_win_per_sec.toFixed(2)} windows/s**`,
  ];
  for (const model of metrics.models ?? []) {
    const memory = model.memory_used_mib !== undefined && model.memory_total_mib !== undefined
      ? `显存 ${model.memory_used_mib}/${model.memory_total_mib} MiB` : "显存未知";
    const utilization = model.utilization_percent !== undefined ? `利用率 ${model.utilization_percent}%` : "利用率未知";
    const temperature = model.temperature_c !== undefined ? `${model.temperature_c}°C` : "温度未知";
    const speed = model.progress ? `，${model.progress.win_per_sec.toFixed(2)} win/s` : "，空闲";
    lines.push(`GPU ${model.gpu}：${model.healthy ? "正常" : `异常（${model.reason}）`}，${memory}，${utilization}，${temperature}${speed}`);
  }
  lines.push(`采集时间：${metrics.collected_at}`);
  return lines.filter(Boolean).join("\n");
}

async function taskText(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from("jobs").select(JOB_FIELDS)
    .order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`查询任务失败：${error.message}`);
  const matches = ((data ?? []) as Job[]).filter((job) => job.id === id || job.id.startsWith(id));
  if (!matches.length) return `未找到任务 \`${id}\`。任务查询覆盖最近 500 个任务。`;
  if (matches.length > 1) return `任务 ID 前缀 \`${id}\` 匹配到 ${matches.length} 个任务，请提供更完整的 ID。`;
  const job = matches[0];
  const lines = [
    `任务：\`${job.id}\``,
    `标题：${job.title || "未命名"}`,
    `状态：**${job.status}**；基因组：${job.n_genomes}；候选区域：${job.n_regions}`,
    `当前阶段：${job.log_tail || "无"}`,
    `提交时间：${job.created_at}`,
  ];
  if (job.started_at) {
    const elapsed = (new Date(job.finished_at ?? Date.now()).getTime() - new Date(job.started_at).getTime()) / 1000;
    lines.push(`开始时间：${job.started_at}；已运行/耗时：${duration(elapsed)}`);
  }
  if (job.finished_at) lines.push(`完成时间：${job.finished_at}`);
  if (job.error) lines.push(`错误：${job.error.slice(0, 500)}`);
  return lines.join("\n");
}

export async function answerOpsCommand(admin: SupabaseClient, rawText: string) {
  const text = rawText.replace(/@_user_\d+/g, "").trim();
  if (!text || text === "帮助" || text.toLowerCase() === "help") return HELP;
  if (text === "状态" || text.toLowerCase() === "status") return statusText(await latestSnapshot(admin));
  if (text === "排队" || text.toLowerCase() === "queue") return queueText(admin);
  if (text === "模型" || text.toLowerCase() === "models") return modelText(await latestSnapshot(admin));
  const taskMatch = text.match(/^任务\s+([0-9a-fA-F-]{4,36})$/);
  if (taskMatch) return taskText(admin, taskMatch[1].toLowerCase());
  return `无法识别命令“${text.slice(0, 50)}”。\n${HELP}`;
}
