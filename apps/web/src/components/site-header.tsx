import Image from "next/image";
import Link from "next/link";
import { logout } from "@/app/login/actions";

export function SiteHeader() {
  return (
    <header className="bg-quarry text-on-quarry">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-8">
        <Link
          href="/"
          className="rounded focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
        >
          {/* The header is slate in both colour schemes, so it always takes the white logo */}
          <Image
            src="/echdyn-logo-white.webp"
            alt="echdyn"
            width={800}
            height={190}
            priority
            className="h-7 w-auto"
          />
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-on-quarry/80 transition-colors hover:bg-on-quarry/10 hover:text-on-quarry focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
