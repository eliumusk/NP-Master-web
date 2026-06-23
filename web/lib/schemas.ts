import { z } from "zod";

export const TIER_ORDER = ["Tier1", "Tier2", "Tier3", "Tier4", "Tier5"] as const;

export const GenomeUpload = z.object({
  filename: z.string().min(1).max(256),
  genomeName: z.string().min(1).max(160),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive().max(50 * 1024 * 1024),
});

export const JobCreate = z.object({
  title: z.string().min(1).max(160).default("BGCMaster batch"),
  genomes: z.array(GenomeUpload).min(1).max(64),
  threshold: z.number().gt(0).lt(1).default(0.95),
  extendThreshold: z.number().gt(0).lt(1).default(0.8),
  minSupportWindows: z.number().int().min(1).max(20).default(3),
  minLenBp: z.number().int().min(100).max(1_000_000).default(2000),
  safeTierMin: z.enum(TIER_ORDER).default("Tier2"),
  extendFlankBp: z.number().int().min(0).max(100_000).default(5000),
  clientId: z.string().uuid().optional(),
}).refine((v) => v.extendThreshold <= v.threshold, {
  message: "extendThreshold must be <= threshold",
  path: ["extendThreshold"],
});

export type JobCreateInput = z.infer<typeof JobCreate>;

export const CompleteUpload = z.object({
  clientId: z.string().uuid().optional(),
});
