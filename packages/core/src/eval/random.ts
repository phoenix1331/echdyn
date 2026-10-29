/** Small seeded PRNG (mulberry32): the same seed always yields the same synthetic set */
export interface Random {
  next: () => number;
  int: (min: number, max: number) => number;
  /** Uniform value in [min, max] rounded to `decimals` places */
  decimal: (min: number, max: number, decimals: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    decimal: (min, max, decimals) => {
      const factor = 10 ** decimals;
      return Math.round((min + next() * (max - min)) * factor) / factor;
    },
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) {
        throw new Error("pick() needs at least one item");
      }
      return item;
    },
    chance: (probability) => next() < probability,
  };
}
