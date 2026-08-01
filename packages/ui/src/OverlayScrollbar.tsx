import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

interface ScrollbarMetrics {
  top: number;
  height: number;
  visible: boolean;
}

export function overlayScrollbarMetrics(scrollHeight: number, clientHeight: number, scrollTop: number, offsetTop = 0): ScrollbarMetrics {
  const scrollRange = scrollHeight - clientHeight;
  if (scrollRange <= 1 || clientHeight <= 2) return { top: offsetTop, height: 0, visible: false };
  const height = Math.min(clientHeight - 2, Math.max(26, clientHeight * clientHeight / scrollHeight));
  const top = offsetTop + scrollTop / scrollRange * (clientHeight - height);
  return { top, height, visible: true };
}

export function OverlayScrollbar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({ top: 0, height: 0, visible: false });
  const [near, setNear] = useState(false);
  const [active, setActive] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const element = targetRef.current;
    if (!element) return;
    element.classList.add('overlay-scroll-target');
    const update = () => {
      setMetrics(overlayScrollbarMetrics(element.scrollHeight, element.clientHeight, element.scrollTop, element.offsetTop));
    };
    const showTemporarily = () => {
      update();
      setActive(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setActive(false), 850);
    };
    const pointerMove = (event: globalThis.PointerEvent) => {
      const rect = element.getBoundingClientRect();
      setNear(rect.right - event.clientX <= 18);
    };
    const pointerLeave = () => setNear(false);
    const resize = new ResizeObserver(update);
    const mutations = new MutationObserver(update);
    resize.observe(element);
    mutations.observe(element, { childList: true, subtree: true, attributes: true });
    element.addEventListener('scroll', showTemporarily, { passive: true });
    element.addEventListener('pointermove', pointerMove, { passive: true });
    element.addEventListener('pointerleave', pointerLeave);
    update();
    return () => {
      window.clearTimeout(hideTimer.current);
      resize.disconnect();
      mutations.disconnect();
      element.removeEventListener('scroll', showTemporarily);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerleave', pointerLeave);
      element.classList.remove('overlay-scroll-target');
    };
  }, [targetRef]);

  const drag = (event: PointerEvent<HTMLSpanElement>) => {
    const element = targetRef.current;
    if (!element) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startScroll = element.scrollTop;
    const trackRange = element.clientHeight - metrics.height;
    const scrollRange = element.scrollHeight - element.clientHeight;
    if (trackRange <= 0) return;
    const move = (moveEvent: globalThis.PointerEvent) => {
      element.scrollTop = startScroll + (moveEvent.clientY - startY) * scrollRange / trackRange;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  if (!metrics.visible) return null;
  return <span aria-hidden="true" className={`overlay-scrollbar${near || active ? ' visible' : ''}`} style={{ top: metrics.top, height: metrics.height }} onPointerDown={drag} />;
}
