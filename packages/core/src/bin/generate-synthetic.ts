import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeSyntheticSet } from "../eval";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "30" },
    seed: { type: "string", default: "1331" },
    out: {
      type: "string",
      default: resolve(import.meta.dirname, "../../../../eval/sets/synthetic"),
    },
    "scanned-out": {
      type: "string",
      default: resolve(import.meta.dirname, "../../../../eval/sets/scanned"),
    },
    "mixed-out": {
      type: "string",
      default: resolve(import.meta.dirname, "../../../../eval/sets/mixed"),
    },
  },
});

const bills = await writeSyntheticSet({
  count: Number(values.count),
  seed: Number(values.seed),
  outDir: resolve(values.out),
  scannedDir: resolve(values["scanned-out"]),
  mixedDir: resolve(values["mixed-out"]),
});

console.log(`wrote ${String(bills.length)} synthetic bills to ${resolve(values.out)}`);
console.log(`wrote ${String(bills.length)} scanned copies to ${resolve(values["scanned-out"])}`);
console.log(`wrote ${String(bills.length)} mixed copies to ${resolve(values["mixed-out"])}`);
