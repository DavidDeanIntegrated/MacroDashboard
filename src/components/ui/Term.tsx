'use client';

// <Term k="vix">VIX</Term> — inline glossary term with a dotted underline and a
// plain-English tooltip. Hover on desktop, tap to toggle on touch devices.
// <Explainer title="How is this calculated?"> — a small collapsible block for
// longer "how this works" notes that shouldn't clutter the default view.

import { useState, useRef, useEffect } from 'react';
import { GLOSSARY } from '@/lib/glossary';

export function Term({
  k,
  children,
  def,
}: {
  k?: string;
  children: React.ReactNode;
  def?: string; // inline definition override when a one-off term isn't in the glossary
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const entry = k ? GLOSSARY[k] : undefined;
  const definition = def ?? entry?.def;
  const title = entry?.term;

  // Close on outside tap (mobile)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  if (!definition) return <>{children}</>;

  return (
    <span ref={ref} className="relative inline">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="underline decoration-dotted decoration-black/30 underline-offset-2 cursor-help hover:decoration-accent-blue hover:text-accent-blue/90 transition-colors text-inherit font-inherit"
      >
        {children}
      </button>
      {open && (
        <span
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[85vw] p-3 rounded-xl bg-white border border-black/[0.08] shadow-lg shadow-black/[0.08] text-left animate-fade-in block"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {title && (
            <span className="block text-xs font-semibold text-black/75 mb-1">{title}</span>
          )}
          <span className="block text-xs text-black/55 leading-relaxed font-normal normal-case tracking-normal">
            {definition}
          </span>
        </span>
      )}
    </span>
  );
}

export function Explainer({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {open && (
        <div className="mt-2 p-3.5 bg-black/[0.02] rounded-xl border border-black/[0.05] text-xs text-black/55 leading-relaxed space-y-2 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}
