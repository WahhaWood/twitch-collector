import Link from "next/link";
import { Suspense } from "react";
import { AccountView } from "@/components/account-view";
import { Shell } from "@/components/shell";
import { Skeleton } from "@/components/ui";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  return <AccountView id={(await params).id} />;
}

export default function AccountPage(props: PageProps<"/accounts/[id]">) {
  return (
    <Shell section="/accounts">
      <Link href="/accounts" className="self-start text-sm text-mut hover:text-acc-t">
        ← Аккаунты
      </Link>
      <Suspense fallback={<Skeleton rows={4} />}>
        <Content params={props.params} />
      </Suspense>
    </Shell>
  );
}
