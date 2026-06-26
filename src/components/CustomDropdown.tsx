import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Option {
  value: string | number;
  label: React.ReactNode;
}

interface CustomDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export default function CustomDropdown({ options, value, onChange, placeholder = '-- Choisissez --', disabled = false, required = false, className = '' }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (!triggerRef.current) return;
      const trg = triggerRef.current;
      const list = listRef.current;
      if (trg.contains(e.target as Node)) return;
      if (list && list.contains(e.target as Node)) return;
      setOpen(false);
    }

    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPortalStyle({ position: 'absolute', top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX, minWidth: rect.width, zIndex: 10000 });

    function onScrollOrResize() {
      const r = triggerRef.current!.getBoundingClientRect();
      setPortalStyle({ position: 'absolute', top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX, minWidth: r.width, zIndex: 10000 });
    }

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const selected = options.find((o) => String(o.value) === String(value));

  function handleSelect(v: string | number) {
    onChange(String(v));
    setOpen(false);
  }

  function scrollByAmount(amount: number) {
    if (!listRef.current) return;
    listRef.current.scrollBy({ top: amount, behavior: 'smooth' });
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => !disabled && setOpen((s) => !s)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-slate-200 text-xs sm:text-sm rounded-xl focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'text-slate-800 font-semibold' : 'text-slate-500'}>{selected ? selected.label : placeholder}</span>
        <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 8L10 12L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && createPortal(
        <div style={portalStyle}>
          <div ref={listRef} className="bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-auto" role="listbox">
            <div className="sticky top-0 bg-white z-10 p-1 border-b border-slate-100 flex justify-center">
              <button type="button" onClick={() => scrollByAmount(-80)} className="px-2 py-1 text-xs bg-slate-50 rounded hover:bg-slate-100">▲</button>
            </div>
            <div>
              <div onClick={() => handleSelect('')} className="px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 cursor-pointer">{placeholder}</div>
              {options.map((opt) => (
                <div key={String(opt.value)} onClick={() => handleSelect(opt.value)} className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                  {opt.label}
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 bg-white z-10 p-1 border-t border-slate-100 flex justify-center">
              <button type="button" onClick={() => scrollByAmount(80)} className="px-2 py-1 text-xs bg-slate-50 rounded hover:bg-slate-100">▼</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* hidden input to keep form semantics */}
      <input type="hidden" value={value} required={required} />
    </div>
  );
}
