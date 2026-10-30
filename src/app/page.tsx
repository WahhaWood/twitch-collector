import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";
import { Shell } from "@/components/shell";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

async function Content() {
  const user = await getCurrentUser();
  return user ? (
    <Shell section="/" wide>
      <Dashboard name={user.name} />
    </Shell>
  ) : (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Twitch Collector</h1>
      <p className="text-sm text-mut">Прогресс дропсов и значков ваших Twitch-аккаунтов в одном месте.</p>
      <LoginForm />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
