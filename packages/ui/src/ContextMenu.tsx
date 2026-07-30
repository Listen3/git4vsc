import { useEffect } from 'react';

export interface ContextMenuItem {
  id: string;
  label?: string;
  disabled?: boolean;
  separator?: boolean;
}

export function ContextMenu({ x, y, items, onSelect, onClose }: {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', keydown);
    };
  }, [onClose]);

  const width = 245;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - items.length * 25 - 8);
  return (
    <div className="context-menu" style={{ left: Math.max(8, left), top: Math.max(8, top) }} onPointerDown={event => event.stopPropagation()}>
      {items.map((item, index) => item.separator
        ? <div className="context-menu-separator" key={`separator-${index}`} />
        : <button key={item.id} type="button" disabled={item.disabled} onClick={() => { onSelect(item.id); onClose(); }}>{item.label}</button>)}
    </div>
  );
}
