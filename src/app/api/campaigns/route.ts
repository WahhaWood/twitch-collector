import { apiError, getCurrentUser } from "@/lib/auth";
import { getCatalog } from "@/lib/cached";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== null && kind !== "drop" && kind !== "badge") return apiError(400, "bad_request", "kind must be drop or badge");
  return Response.json({ items: await getCatalog(kind) });
}
