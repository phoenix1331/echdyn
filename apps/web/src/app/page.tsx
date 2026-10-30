import { logout } from "./login/actions";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">echdyn</span>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="px-6 py-8 text-zinc-600 dark:text-zinc-400">
        <p>Documents will be listed here.</p>
      </main>
    </div>
  );
}
