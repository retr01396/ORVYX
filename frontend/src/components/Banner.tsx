import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const Banner: React.FC = () => {
  return (
    <div className="w-full bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 flex items-center justify-center gap-2 text-amber-300 text-xs font-medium tracking-wide shadow-sm z-50">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>
        <strong className="font-semibold text-amber-200 uppercase tracking-wider mr-1.5">Investigational Use:</strong>
        AI-assisted research prototype — not a diagnostic device. All predictions require licensed radiologist review.
      </span>
    </div>
  );
};
