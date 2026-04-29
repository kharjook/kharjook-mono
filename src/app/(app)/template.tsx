'use client';

import type { ReactNode } from 'react';

export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-[page-in_220ms_ease-out]">{children}</div>;
}
