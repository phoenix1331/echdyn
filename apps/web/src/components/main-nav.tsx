"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  {
    href: "/",
    label: "Documents",
    matches: (path: string) => path === "/" || path.startsWith("/documents"),
  },
  { href: "/records", label: "Records", matches: (path: string) => path.startsWith("/records") },
];

const link =
  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-on-quarry/10 hover:text-on-quarry focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none";

/**
 * The same links with nothing marked: what the header renders before the current path is
 * known (the path is request data, so MainNav streams in behind a Suspense boundary)
 */
export function MainNavFallback() {
  return (
    <nav aria-label="Main" className="flex gap-1">
      {LINKS.map(({ href, label }) => (
        <Link key={href} href={href} className={`${link} text-on-quarry/80`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** The sections, with the current one marked for sight and for screen readers */
export function MainNav() {
  const path = usePathname();

  return (
    <nav aria-label="Main" className="flex gap-1">
      {LINKS.map(({ href, label, matches }) => {
        const current = matches(path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`${link} ${current ? "bg-on-quarry/10 text-on-quarry" : "text-on-quarry/80"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
