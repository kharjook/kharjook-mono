'use client';

import type { ReactNode } from 'react';

export interface NavItemProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function NavItem({
  icon,
  label,
  isActive,
  onClick,
  disabled,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1.5 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${isActive ? 'text-purple-400' : 'text-slate-500 hover:text-slate-400'}`}
    >
      <div
        className={`p-1.5 rounded-xl transition-all ${isActive ? 'bg-purple-500/20' : 'bg-transparent'}`}
      >
        {icon}
      </div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
