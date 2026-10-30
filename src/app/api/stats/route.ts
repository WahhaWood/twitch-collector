import { apiError, getCurrentUser } from "@/lib/auth";
import { validTimeZone } from "@/lib/stats";
import { buildStats } from "@/lib/stats-data";

const RANGES = new Set([7, 30, 90]);

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const params = new URL(req.url).searchParams;
  const days = Number(params.get("days") ?? 30);
  if (!RANGES.has(days)) return apiError(400, "bad_request", "days must be 7, 30 or 90");
  return Response.json(await buildStats(user.id, days, validTimeZone(params.get("tz"))));
}
