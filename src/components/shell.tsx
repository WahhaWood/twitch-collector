import type { ReactNode } from "react";
import { Header, type Section } from "./header";

// Content hugs the left edge (Nocturne); narrow pages leave whitespace on the right, the overview uses the full width.
export function Shell({ section, wide, children }: { section: Section; wide?: boolean; children: ReactNode }) {
  return (
    <>
      <Header section={section} />
      <main className="mx-auto w-full max-w-7xl px-4 pt-1 pb-7 sm:px-10 sm:pt-7 sm:pb-11">
        <div className={`flex flex-col gap-4 ${wide ? "" : "max-w-5xl"}`}>{children}</div>
      </main>
    </>
  );
}
