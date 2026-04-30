import { z } from "zod";

// Anonymous users get 25 MB; logged-in get up to 50 MB. Enforced per-tier in
// the API route; schema allows the bigger value for both.
export const JobCreate = z.object({
  filename: z.string().min(1).max(256),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive().max(50 * 1024 * 1024),
  threshold: z.number().gt(0).lt(1).default(0.5),
  minLenBp: z.number().int().min(100).max(1_000_000).default(2000),
  // Optional for logged-in flow; required for anon (browser-generated UUID).
  clientId: z.string().uuid().optional(),
  // Optional Turnstile token: enforced when env is configured.
  turnstileToken: z.string().optional(),
});

export type JobCreateInput = z.infer<typeof JobCreate>;

