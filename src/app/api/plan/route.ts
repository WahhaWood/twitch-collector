import { apiError, getCurrentUser } from "@/lib/auth";
import { buildPlan } from "@/lib/stats-data";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  return Response.json(await buildPlan(user.id));
}
