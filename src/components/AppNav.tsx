"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./AccountGate";

const LINKS = [
  { href: "/board", label: "Tool wall" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

export function AppNav() {
  const me = useMe();
  const pathname = usePathname();
  const links = me.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  return (
    <header className="border-b-2 border-ink bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
        <Link href="/" className="font-display text-3xl font-black no-underline">
          LendLoop
        </Link>
        <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
          {links.map(({ href, label }) => {
            const current = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                className={`rounded-[3px] px-3 py-2 whitespace-nowrap no-underline ${
                  current ? "bg-ink font-bold text-panel" : "hover:bg-board"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
