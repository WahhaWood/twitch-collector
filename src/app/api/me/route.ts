import { apiError, getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Login required");
  return Response.json({ user });
}
