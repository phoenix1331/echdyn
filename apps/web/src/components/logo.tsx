import Image from "next/image";

/**
 * The frame is lilac in light mode and navy in dark mode, so the logo swaps with it.
 * Both are rendered and CSS hides one, which avoids a flash before the scheme is known.
 */
export function Logo({ className }: { className: string }) {
  return (
    <>
      <Image
        src="/echdyn-logo-dark.webp"
        alt="echdyn"
        width={800}
        height={190}
        priority
        className={`${className} dark:hidden`}
      />
      <Image
        src="/echdyn-logo-white.webp"
        alt="echdyn"
        width={800}
        height={190}
        priority
        className={`${className} hidden dark:block`}
      />
    </>
  );
}
