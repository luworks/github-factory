import { expect, test } from "bun:test";
import { animatePreview } from "../src/gallery/animation";

test("gallery clock bounds paints, serves every visible subscriber and stops its last frame", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const queued = new Map<number, FrameRequestCallback>();
  let next = 0;
  globalThis.requestAnimationFrame = (callback) => { queued.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => { queued.delete(id); };
  const paints = Array(7).fill(0) as number[];
  const stop = paints.map((_, index) => animatePreview(() => { paints[index]++; }));
  const advance = (time: number) => {
    const callbacks = [...queued.values()]; queued.clear();
    for (const callback of callbacks) callback(time);
  };
  try {
    expect(queued.size).toBe(1);
    advance(100);
    expect(paints.reduce((a, b) => a + b, 0)).toBe(6);
    advance(130);
    expect(paints.reduce((a, b) => a + b, 0)).toBe(6);
    advance(200);
    expect(paints.reduce((a, b) => a + b, 0)).toBe(12);
    expect(paints.every((count) => count > 0)).toBe(true);
    for (const unsubscribe of stop) unsubscribe();
    expect(queued.size).toBe(0);
  } finally {
    for (const unsubscribe of stop) unsubscribe();
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
