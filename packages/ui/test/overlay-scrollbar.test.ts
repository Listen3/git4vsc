import { describe, expect, it } from 'vitest';
import { overlayScrollbarMetrics } from '../src/OverlayScrollbar.js';

describe('overlay scrollbar metrics', () => {
  it('hides when content fits', () => {
    expect(overlayScrollbarMetrics(200, 200, 0, 30)).toEqual({ top: 30, height: 0, visible: false });
  });

  it('tracks the viewport without reserving content width', () => {
    const start = overlayScrollbarMetrics(1_000, 200, 0, 30);
    const end = overlayScrollbarMetrics(1_000, 200, 800, 30);
    expect(start).toEqual({ top: 30, height: 40, visible: true });
    expect(end.top).toBe(190);
  });
});
