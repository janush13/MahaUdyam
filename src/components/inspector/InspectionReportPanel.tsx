import React, { useRef, useState } from 'react';
import { EvidenceFile, InspectionOutcome, InspectionRecord, InspectionReport } from '../../types/inspector';
import { MAX_OBSERVATION_CHARS, SAMPLE_EVIDENCE } from '../../services/inspectorService';

interface Props {
  rec: InspectionRecord;
  report: InspectionReport;
  errors: string[];
  onChange: (patch: Partial<InspectionReport>) => void;
  onSaveDraft: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onNotify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const sizeLabel = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export const InspectionReportPanel: React.FC<Props> = ({ rec, report, errors, onChange, onSaveDraft, onCancel, onSubmit, onNotify }) => {
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const locked = report.status === 'SUBMITTED';

  const addPhotos = (files: FileList | File[]) => {
    const added: EvidenceFile[] = [];
    Array.from(files).forEach((f) => {
      if (!/^image\/(jpeg|png)$/.test(f.type)) {
        onNotify(`${f.name}: only JPG or PNG photographs are accepted.`, 'error');
      } else if (f.size > 10 * 1048576) {
        onNotify(`${f.name}: exceeds the 10 MB limit.`, 'error');
      } else if (!report.evidence.some((e) => e.name === f.name) && !added.some((e) => e.name === f.name)) {
        added.push({ name: f.name, sizeLabel: sizeLabel(f.size) });
      }
    });
    if (added.length > 0) onChange({ evidence: [...report.evidence, ...added] });
  };

  const addSample = () => {
    const next = SAMPLE_EVIDENCE.find((s) => !report.evidence.some((e) => e.name === s.name));
    if (!next) {
      onNotify('All sample photographs have already been attached.', 'info');
      return;
    }
    onChange({ evidence: [...report.evidence, next] });
  };

  const addSupporting = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') return onNotify('Supporting documents must be PDF files.', 'error');
    if (f.size > 15 * 1048576) return onNotify('The supporting document exceeds the 15 MB limit.', 'error');
    onChange({ supportingDoc: { name: f.name, sizeLabel: sizeLabel(f.size) } });
  };

  const outcomes: Array<{ value: InspectionOutcome; label: string; cls: string; box: string }> = [
    { value: 'compliant', label: 'Compliant', cls: 'text-emerald-600 focus:ring-emerald-500', box: '' },
    { value: 'non-compliant', label: 'Non-Compliant', cls: 'text-red-600 focus:ring-red-500', box: '' },
    { value: 'partially-compliant', label: 'Partially Compliant', cls: 'text-amber-600 focus:ring-amber-500', box: 'bg-amber-50 border border-amber-300 px-2 py-1 rounded' },
  ];

  const statusChip: Record<InspectionReport['status'], string> = {
    NOT_STARTED: 'bg-slate-200 text-slate-700',
    IN_PROGRESS: 'bg-amber-100 text-amber-800',
    DRAFT_SAVED: 'bg-blue-100 text-blue-800',
    SUBMITTED: 'bg-emerald-100 text-emerald-800',
  };
  const statusText: Record<InspectionReport['status'], string> = {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    DRAFT_SAVED: 'Draft saved',
    SUBMITTED: 'Submitted',
  };

  return (
    <section className="lg:col-span-6 bg-white border border-slate-300 rounded shadow-sm flex flex-col justify-between" data-purpose="panel-submit-report" id="submit-report">
      <div>
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-slate-500 font-medium tracking-wide">STATUTORY RETURN - FORM 7</div>
            <h3 className="text-base font-bold text-[#0B2265]">Submit Inspection Report</h3>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">{rec.formNo}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusChip[report.status]}`}>{statusText[report.status]}</span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {locked && (
            <div className="p-3 rounded bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
              <p className="font-bold">✓ Statutory report submitted — read-only</p>
              <p className="text-[11px] mt-0.5">
                Reference <span className="font-mono font-semibold">{report.submissionRef}</span> • {report.submittedAt}. An immutable RTS audit entry has been recorded.
              </p>
            </div>
          )}
          {errors.length > 0 && !locked && (
            <div role="alert" className="p-3 rounded bg-red-50 border border-red-300 text-xs text-red-800">
              <p className="font-bold mb-1">Cannot submit the report — resolve the following:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}

          <fieldset disabled={locked}>
            <legend className="block text-xs font-bold text-slate-800 mb-1.5">
              Inspection Outcome <span className="text-red-600">*</span>
            </legend>
            <div className="flex flex-wrap gap-4 text-xs">
              {outcomes.map((o) => (
                <label key={o.value} className={`inline-flex items-center space-x-2 cursor-pointer ${report.outcome === o.value ? o.box : ''}`}>
                  <input type="radio" name="inspection_outcome" value={o.value} checked={report.outcome === o.value} onChange={() => onChange({ outcome: o.value })} className={`h-4 w-4 border-slate-300 ${o.cls}`} />
                  <span className={`font-semibold ${report.outcome === o.value && o.value === 'partially-compliant' ? 'text-amber-900 font-bold' : 'text-slate-700'}`}>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-800" htmlFor="insp-observations">
                Observations &amp; Statutory Remarks <span className="text-red-600">*</span>
              </label>
              <span className="text-[10px] text-slate-500 font-medium">{report.observations.length} / {MAX_OBSERVATION_CHARS} chars</span>
            </div>
            <textarea
              id="insp-observations"
              rows={5}
              maxLength={MAX_OBSERVATION_CHARS}
              disabled={locked}
              value={report.observations}
              onChange={(e) => onChange({ observations: e.target.value })}
              placeholder="Enter detailed observations from site inspection..."
              className="w-full text-xs text-slate-800 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B2265] focus:border-[#0B2265] p-2.5 leading-relaxed bg-slate-50/50 disabled:opacity-70"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Upload Evidence Photos <span className="text-red-600">*</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-disabled={locked}
              onClick={() => !locked && photoInput.current?.click()}
              onKeyDown={(e) => {
                if (!locked && (e.key === 'Enter' || e.key === ' ')) photoInput.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!locked) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!locked) addPhotos(e.dataTransfer.files);
              }}
              className={`border-2 border-dashed rounded-md p-3 text-center bg-slate-50/60 transition ${locked ? 'opacity-60' : 'cursor-pointer hover:border-[#0B2265]'} ${dragging ? 'border-[#0B2265] bg-blue-50' : 'border-slate-300'}`}
            >
              <div className="flex flex-col items-center justify-center space-y-1">
                <span className="text-2xl">🖼️</span>
                <p className="text-xs font-semibold text-slate-700">
                  Drag &amp; drop images here or <span className="text-[#0B2265] underline font-bold">click to browse</span>
                </p>
                <p className="text-[10px] text-slate-500">Supports JPG, PNG with Geotag EXIF (Max 10 MB each)</p>
              </div>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addPhotos(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              {report.evidence.map((e) => (
                <span key={e.name} className="inline-flex items-center text-[11px] bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                  {e.name} ({e.sizeLabel})
                  {!locked && (
                    <button type="button" onClick={() => onChange({ evidence: report.evidence.filter((x) => x.name !== e.name) })} className="ml-1.5 text-slate-400 hover:text-red-600" aria-label={`Remove ${e.name}`}>×</button>
                  )}
                </span>
              ))}
              {!locked && (
                <button type="button" onClick={addSample} className="text-[11px] text-[#0B2265] font-semibold underline">+ Attach sample geotagged photo</button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">Supporting Documents (Optional)</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" disabled={locked} onClick={() => docInput.current?.click()} className="inline-flex items-center space-x-1.5 bg-white border border-slate-300 px-3 py-1.5 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                <span>⬆</span>
                <span>Upload Signed Checklist / Notice</span>
              </button>
              <span className="text-[10px] text-slate-500">PDF, scanned with official stamp (Max 15MB)</span>
            </div>
            <input ref={docInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => { addSupporting(e.target.files); e.target.value = ''; }} />
            {report.supportingDoc && (
              <span className="mt-2 inline-flex items-center text-[11px] bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-blue-500 mr-1.5" />
                {report.supportingDoc.name} ({report.supportingDoc.sizeLabel})
                {!locked && <button type="button" onClick={() => onChange({ supportingDoc: null })} className="ml-1.5 text-slate-400 hover:text-red-600" aria-label="Remove supporting document">×</button>}
              </span>
            )}
          </div>

          {report.savedAt && !locked && <p className="text-[10px] text-slate-500">Draft last saved {report.savedAt}</p>}
        </div>
      </div>

      <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
        <button type="button" disabled={locked} onClick={onSaveDraft} className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 transition shadow-sm disabled:opacity-40">
          Save as Draft
        </button>
        <div className="flex space-x-2">
          <button type="button" disabled={locked} onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 disabled:opacity-40">Cancel</button>
          <button type="button" disabled={locked} onClick={onSubmit} className="px-5 py-1.5 text-xs font-bold text-white bg-[#153B8A] hover:bg-[#0B2265] rounded transition shadow-sm flex items-center gap-1.5 disabled:opacity-40">
            <span>✓</span>
            <span>Submit Statutory Report</span>
          </button>
        </div>
      </div>
    </section>
  );
};
