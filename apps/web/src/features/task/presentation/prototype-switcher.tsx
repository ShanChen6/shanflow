'use client';

// PROTOTYPE — remove when a variant is chosen. A bottom bar that flips ?variant= between the layouts; it never ships to production.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export interface VariantInfo {
  id: string;
  label: string;
}

export function PrototypeSwitcher({ variants, current }: { variants: VariantInfo[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('variant', id);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const step = (delta: number) => {
    const index = variants.findIndex((variant) => variant.id === current);
    go(variants[(index + delta + variants.length) % variants.length]!.id);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return; // never steal arrow keys from a field
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;
  return (
    <div
      role="toolbar"
      aria-label="Prototype variants"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-lg"
    >
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)} className="px-2">
        ←
      </button>
      {variants.map((variant) => (
        <button
          key={variant.id}
          type="button"
          aria-pressed={variant.id === current}
          onClick={() => go(variant.id)}
          className={`rounded-full px-3 py-0.5 ${variant.id === current ? 'bg-brand-500 text-brand-ink' : 'text-slate-600'}`}
        >
          {variant.id} · {variant.label}
        </button>
      ))}
      <button type="button" aria-label="Next variant" onClick={() => step(1)} className="px-2">
        →
      </button>
    </div>
  );
}
