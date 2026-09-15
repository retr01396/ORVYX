import React, { useState } from 'react';
import {
  Sparkles,
  Focus,
  Activity,
  ShieldAlert,
  Send,
  HelpCircle,
  X,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import type {
  CoPilotResponse,
  CoPilotFinding,
  CoPilotMeasurement,
  AskResponse,
} from '../../types/copilot';

interface AICoPilotPanelProps {
  data: CoPilotResponse | null;
  loading: boolean;
  onClose: () => void;
  onSelectFinding: (finding: CoPilotFinding) => void;
  onSelectMeasurement: (measurement: CoPilotMeasurement) => void;
  selectedFindingId: string | null;
}

const PREDEFINED_PROMPTS = [
  'Summarize this study',
  'What are the main findings?',
  'Show me the heart',
  'What structures were segmented?',
  'What quantitative measurements are available?',
  'What are the limitations?',
];

export const AICoPilotPanel: React.FC<AICoPilotPanelProps> = ({
  data,
  loading,
  onClose,
  onSelectFinding,
  onSelectMeasurement,
  selectedFindingId,
}) => {
  const [question, setQuestion] = useState<string>('');
  const [asking, setAsking] = useState<boolean>(false);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const handleAsk = async (queryText: string) => {
    if (!queryText.trim() || asking) return;
    setAsking(true);
    setAskError(null);

    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          study_id: data?.study_id || 'multimodal',
          question: queryText,
        }),
      });

      if (!res.ok) {
        throw new Error(`Inquiry error: ${res.statusText}`);
      }

      const result: AskResponse = await res.json();
      setAskResult(result);
    } catch (err: any) {
      console.error('Ask Co-Pilot failed:', err);
      setAskError(err.message || 'Failed to process clinical query');
    } finally {
      setAsking(false);
    }
  };

  const handleSubmitCustomQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    handleAsk(question);
  };

  return (
    <aside className="w-96 bg-slate-900/95 border-l border-slate-800 flex flex-col h-full select-none overflow-hidden shrink-0 z-30 shadow-2xl backdrop-blur-md">
      {/* 1. Panel Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-sm text-white tracking-wide">AI Co-Pilot</h2>
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                Phase 3 Verified
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono leading-none">
              Multimodal Clinical Assistant
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close Co-Pilot Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-400 font-mono text-xs">
            <Sparkles className="w-6 h-6 text-purple-400 animate-spin" />
            <span>Synthesizing Multimodal Study Evidence...</span>
          </div>
        ) : !data ? (
          <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-800 text-xs text-slate-400 text-center font-mono">
            No study context active. Select a study to activate the Co-Pilot.
          </div>
        ) : (
          <>
            {/* Section A: Clinical Study Summary */}
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-purple-300 uppercase tracking-wider font-mono">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  Clinical Study Summary
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                  {data.modality}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {data.summary}
              </p>

              {data.impression && data.impression.length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1">
                  <span className="text-[10px] uppercase font-mono text-slate-400 font-semibold tracking-wide">
                    Impression:
                  </span>
                  {data.impression.map((imp, idx) => (
                    <div
                      key={idx}
                      className="text-[11px] text-slate-300 font-sans leading-relaxed flex items-start gap-1.5"
                    >
                      <ChevronRight className="w-3 h-3 text-purple-400 shrink-0 mt-0.5" />
                      <span>{imp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section B: Prioritized Findings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  Prioritized Findings ({data.findings.length})
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Click to Focus Anatomy
                </span>
              </div>

              <div className="space-y-2.5">
                {data.findings.map((f) => {
                  const isSelected = selectedFindingId === f.id;
                  return (
                    <div
                      key={f.id}
                      onClick={() => onSelectFinding(f)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                        isSelected
                          ? 'bg-purple-950/50 border-purple-500/80 shadow-md shadow-purple-500/10'
                          : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-mono font-bold shrink-0 ${
                              f.severity === 'high'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : f.severity === 'moderate'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {f.severity}
                          </span>
                          <h4 className="text-xs font-bold text-slate-100 truncate">
                            {f.title}
                          </h4>
                        </div>

                        <span className="text-[10px] font-mono text-slate-400 shrink-0 font-semibold">
                          {(f.confidence * 100).toFixed(1)}%
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300 leading-snug font-sans mb-2">
                        {f.description}
                      </p>

                      {/* Evidence Tags */}
                      {f.evidence && f.evidence.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {f.evidence.map((ev, evIdx) => (
                            <div
                              key={evIdx}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900/90 text-slate-400 border border-slate-800 flex items-center gap-1"
                            >
                              <span className="text-purple-400 font-bold uppercase">
                                {ev.type.replace('_', ' ')}:
                              </span>
                              <span className="text-slate-300">{ev.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action Button */}
                      {f.anatomy && (
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80">
                          <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                            {f.anatomy.label}
                          </span>
                          <button
                            type="button"
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-600/30 text-purple-200 hover:bg-purple-600 hover:text-white border border-purple-500/40 flex items-center gap-1 transition-colors"
                          >
                            <Focus className="w-3 h-3" />
                            <span>Focus in {f.anatomy.modality.toUpperCase()}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section C: Quantitative Morphometry (CT) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                  Quantitative Morphometry ({data.measurements.length})
                </span>
                <span className="text-[10px] font-mono text-slate-500">Verified Data</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {data.measurements.map((m, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSelectMeasurement(m)}
                    className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer transition-all hover:bg-slate-900"
                  >
                    <div className="text-[10px] font-mono text-slate-400 truncate mb-1">
                      {m.name}
                    </div>
                    <div className="text-sm font-bold font-mono text-cyan-300">
                      {m.value.toFixed(1)}{' '}
                      <span className="text-[10px] text-slate-400 font-normal">
                        {m.unit}
                      </span>
                    </div>
                    {m.reference_range && (
                      <div className="text-[9px] font-mono text-slate-500 mt-0.5">
                        Ref: {m.reference_range}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Section D: Interactive Ask Co-Pilot */}
            <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-purple-400" />
                  Ask Co-Pilot
                </span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-purple-500/10 text-purple-300">
                  Offline Intent Engine
                </span>
              </div>

              {/* Predefined Quick Prompts */}
              <div className="flex flex-wrap gap-1.5">
                {PREDEFINED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setQuestion(prompt);
                      handleAsk(prompt);
                    }}
                    className="px-2 py-1 rounded-md bg-slate-850 hover:bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-750 hover:border-purple-500/40 transition-colors text-left"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Natural Language Question Form */}
              <form onSubmit={handleSubmitCustomQuestion} className="flex gap-1.5">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a question about this study..."
                  className="flex-1 bg-slate-900 border border-slate-750 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
                <button
                  type="submit"
                  disabled={asking || !question.trim()}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Send className="w-3 h-3" />
                </button>
              </form>

              {/* Error notice if any */}
              {askError && (
                <div className="p-2 rounded bg-rose-950/60 border border-rose-500/30 text-[10px] font-mono text-rose-300">
                  {askError}
                </div>
              )}

              {/* Answer Card */}
              {askResult && (
                <div className="p-3 rounded-lg bg-slate-900 border border-purple-500/40 space-y-2 mt-2 shadow-sm">
                  <div className="flex items-center justify-between text-[10px] font-mono text-purple-300">
                    <span className="font-bold uppercase tracking-wide">
                      Intent: {askResult.intent}
                    </span>
                    <span className="text-slate-400">Deterministic</span>
                  </div>

                  <p className="text-xs text-slate-200 leading-relaxed font-sans">
                    {askResult.answer}
                  </p>

                  {askResult.highlights && askResult.highlights.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                      {askResult.highlights.map((h, hIdx) => (
                        <div
                          key={hIdx}
                          className="text-[10px] font-mono text-slate-300 flex items-start gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {askResult.target_structure_id && (
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">
                        Referenced: {askResult.target_structure_id}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const matchingFinding = data.findings.find(
                            (f) =>
                              f.anatomy &&
                              f.anatomy.structure_id === askResult.target_structure_id
                          );
                          if (matchingFinding) {
                            onSelectFinding(matchingFinding);
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-purple-600/30 text-purple-200 hover:bg-purple-600 hover:text-white border border-purple-500/40 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Focus className="w-3 h-3" />
                        <span>Focus Structure</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section E: Safety Disclaimers & Provenance */}
            <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2 text-[10px] font-mono text-slate-400">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold uppercase tracking-wider">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Clinical Limitations & Provenance</span>
              </div>
              <ul className="space-y-1 text-slate-400 font-sans list-disc list-inside">
                {data.limitations.map((lim, limIdx) => (
                  <li key={limIdx} className="leading-snug">
                    {lim}
                  </li>
                ))}
              </ul>
              <div className="pt-1.5 border-t border-slate-800 flex justify-between text-[9px] text-slate-500">
                <span>Engine: {data.provenance.provider}</span>
                <span>Mode: {data.provenance.mode}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
