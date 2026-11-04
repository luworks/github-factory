// One shared 12fps clock. At most four cards repaint per tick; round-robin keeps
// every visible world moving even on unusually tall viewports. No offscreen subscribers.
const painters = new Set<(time: number) => void>();
let frame = 0, last = 0, cursor = 0;
function tick(now: number) {
  if (now - last >= 1000 / 12) {
    last = now;
    const list = [...painters];
    const count = Math.min(4, list.length);
    for (let i = 0; i < count; i++) list[(cursor + i) % list.length](now / 1000);
    cursor = list.length ? (cursor + count) % list.length : 0;
  }
  frame = painters.size ? requestAnimationFrame(tick) : 0;
}
export function animatePreview(paint: (time: number) => void) {
  painters.add(paint);
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    painters.delete(paint);
    if (!painters.size) { cancelAnimationFrame(frame); frame = 0; last = 0; cursor = 0; }
  };
}
