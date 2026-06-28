import React from 'react';

interface RequiredLabelProps {
  label: string;
  required?: boolean;
  className?: string;
}

export default function RequiredLabel({ label, required = false, className = '' }: RequiredLabelProps) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-slate-700 ${className}`.trim()}>
      <span>{label}</span>
      {required ? <span className="text-rose-600 font-semibold text-base leading-none" aria-hidden="true">*</span> : null}
    </span>
  );
}
