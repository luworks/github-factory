import { expect, test } from "bun:test";
import { requireExactCounts } from "../scripts/d1-count-contract";
const complete = () => Array.from({ length: 5 }, () => ({ success: true, results: [{ n: 0 }] }));
test("SYNTHETIC table count proof requires exactly five successful singleton nonnegative integers", () => {
  expect(requireExactCounts(complete())).toEqual([0, 0, 0, 0, 0]);
  for (const value of [[], complete().slice(0, 4), [...complete(), complete()[0]], null]) expect(() => requireExactCounts(value)).toThrow();
  for (const mutate of [(r: any) => { r.success = false; }, (r: any) => { r.results = []; }, (r: any) => { r.results = [{ n: 0 }, { n: 1 }]; },
    (r: any) => { r.results = [{ n: -1 }]; }, (r: any) => { r.results = [{ n: true }]; }, (r: any) => { r.results = [{ n: "0" }]; }, (r: any) => { r.results = [{ n: 0.5 }]; }, (r: any) => { r.results = [{ n: 0, extra: 1 }]; }]) {
    const value = complete(); mutate(value[0]); expect(() => requireExactCounts(value)).toThrow();
  }
});
