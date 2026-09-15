import React, { useRef, useState } from 'react';
import { FileText, Play, CheckCircle2, UploadCloud, AlertCircle, Sparkles, X, Clock } from 'lucide-react';
import type { StudySummary } from '../types/studystate';

interface StudyRailProps {
  studies: StudySummary[];
  selectedId: string;
  onSelectStudy: (id: string) => void;
  onAnalyze: (id: string) => void;
  analyzing: boolean;
  hasResult: boolean;
  onUploadStudy?: (file: File) => Promise<void>;
  uploading?: boolean;
  uploadError?: string | null;
  onClearUploadError?: () => void;
}

export const StudyRail: React.FC<StudyRailProps> = ({
  studies,
  selectedId,
  onSelectStudy,
  onAnalyze,
  analyzing,
  hasResult,
  onUploadStudy,
  uploading = false,
  uploadError = null,
  onClearUploadError,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFileValidationAndUpload = async (file: File) => {
    setLocalError(null);
    if (onClearUploadError) onClearUploadError();

    const allowed = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) {
      setLocalError(`Unsupported format '${ext}'. Please upload a PNG, JPEG, or TIFF radiograph.`);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setLocalError('File size exceeds 50 MB limit.');
      return;
    }

    if (onUploadStudy) {
      try {
        await onUploadStudy(file);
      } catch (err: any) {
        setLocalError(err.message || 'Upload failed');
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (uploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileValidationAndUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!uploading) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileValidationAndUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const demoStudies = studies.filter((s) => !s.is_custom);
  const customStudies = studies.filter((s) => s.is_custom);
  const activeError = localError || uploadError;

  return (
    <aside className="w-76 bg-slate-900 border-r border-slate-800 flex flex-col h-full shrink-0 select-none">
      {/* Directory Header */}
      <div className="p-3.5 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            Study Directory
          </h2>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            {studies.length} {studies.length === 1 ? 'Study' : 'Studies'}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Ingest custom radiographs or inspect verified demo studies
        </p>
      </div>

      {/* Ingestion Dropzone */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-950/30">
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.tif,.tiff,.bmp"
          className="hidden"
          onChange={handleInputChange}
          disabled={uploading}
        />
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-3 text-center transition-all cursor-pointer ${
            isDragOver
              ? 'border-cyan-400 bg-cyan-950/30 text-cyan-200 ring-2 ring-cyan-500/30 scale-[1.01]'
              : uploading
              ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-wait'
              : 'border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/40 text-slate-400'
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center justify-center py-1">
              <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-1.5" />
              <span className="text-xs font-semibold text-cyan-300">Ingesting Radiograph...</span>
              <span className="text-[10px] text-slate-400 mt-0.5">Validating pixel geometry</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-1">
              <UploadCloud className={`w-5 h-5 mb-1 ${isDragOver ? 'text-cyan-300' : 'text-slate-400'}`} />
              <span className="text-xs font-semibold text-slate-200">
                {isDragOver ? 'Drop file to ingest' : 'Ingest New Radiograph'}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5">
                Drag & drop or click • PNG, JPEG, TIFF
              </span>
            </div>
          )}
        </div>

        {/* Upload Error Banner */}
        {activeError && (
          <div className="mt-2 p-2 rounded bg-rose-950/80 border border-rose-500/40 text-[11px] text-rose-300 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px] leading-tight">{activeError}</div>
            <button
              onClick={() => {
                setLocalError(null);
                if (onClearUploadError) onClearUploadError();
              }}
              className="text-rose-400 hover:text-rose-200 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Study List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Custom Uploads Section if any */}
        {customStudies.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1 px-1">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>Ingested Custom Studies ({customStudies.length})</span>
            </div>
            {customStudies.map((study) => renderStudyCard(study))}
          </div>
        )}

        {/* Verified Demo Studies Section */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 px-1">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>Verified Benchmark Studies ({demoStudies.length})</span>
          </div>
          {demoStudies.map((study) => renderStudyCard(study))}
        </div>
      </div>

      {/* Action Button */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/90">
        <button
          onClick={() => onAnalyze(selectedId)}
          disabled={analyzing || uploading}
          className={`w-full py-2.5 px-4 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
            analyzing
              ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-500/30 cursor-wait'
              : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/20 active:scale-[0.99]'
          }`}
        >
          {analyzing ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span>Analyzing on MPS Engine...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{hasResult ? 'Re-Analyze Study' : 'Run AI Analysis'}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );

  function renderStudyCard(study: StudySummary) {
    const isSelected = study.study_id === selectedId;
    return (
      <div
        key={study.study_id}
        onClick={() => onSelectStudy(study.study_id)}
        className={`p-3 rounded-lg border transition-all cursor-pointer relative overflow-hidden group ${
          isSelected
            ? 'bg-slate-800/90 border-cyan-500/50 shadow-md shadow-cyan-500/5 ring-1 ring-cyan-500/30'
            : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'
        }`}
      >
        {/* Active Indicator Accent */}
        {isSelected && (
          <div className="absolute top-0 left-0 bottom-0 w-1 bg-cyan-400" />
        )}

        <div className="flex items-start justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-700/60 text-cyan-300">
              {study.modality} • {study.view}
            </span>
            {study.is_custom && (
              <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-500/40 font-semibold">
                Custom
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            {study.patient_id}
          </span>
        </div>

        <h3 className="font-semibold text-xs text-slate-200 mt-1.5 leading-snug">
          {study.title}
        </h3>

        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
          {study.description}
        </p>

        {/* Thumbnail Container */}
        <div className="mt-2 w-full h-24 rounded bg-black/40 border border-slate-800 overflow-hidden flex items-center justify-center relative">
          <img
            src={`/api/xray/image/${study.study_id}`}
            alt={study.title}
            className="w-full h-full object-contain filter contrast-105"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          {isSelected && hasResult && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 flex items-center gap-1 backdrop-blur-sm">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
              <span>Analyzed</span>
            </div>
          )}
        </div>
      </div>
    );
  }
};
