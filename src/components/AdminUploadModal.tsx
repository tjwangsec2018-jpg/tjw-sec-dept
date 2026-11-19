import React, { useEffect, useRef, useState } from 'react';
import { BellRing, FileUp, Plus, Trash2, X } from 'lucide-react';
import { Company, ResolutionCategory } from '../types';
import { createCompany, createResolutionAndNotify } from '../lib/firestoreService';

const CATEGORIES: ResolutionCategory[] = [
  'Board Resolution',
  'Shareholder Resolution',
  'AGM Notice',
  'Bank Mandate',
  'Allotment of Shares',
];

interface UploadModalProps {
  adminUid: string;
  companies: Company[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const AdminUploadModal: React.FC<UploadModalProps> = ({
  adminUid,
  companies,
  onClose,
  onSuccess,
}) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || '');
  const [title, setTitle] = useState('');
  const [referenceCode, setReferenceCode] = useState(
    `RES-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
  );
  const [category, setCategory] = useState<ResolutionCategory>('Board Resolution');
  const [statutoryDueDate, setStatutoryDueDate] = useState(() => {
    const d = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [summary, setSummary] = useState('');
  const [bodyText, setBodyText] = useState(
    'DIRECTORS RESOLUTIONS IN WRITING\n\nRESOLVED THAT:\n(a) The matter described in the attached schedule be and is hereby approved by the Board of Directors;\n(b) The Company Secretary be authorised to lodge all required statutory filings.'
  );
  const [uploadedPdfBytes, setUploadedPdfBytes] = useState<Uint8Array | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');

  const [directors, setDirectors] = useState<
    Array<{ uid?: string; name: string; email: string; selected: boolean }>
  >([]);
  const [extraName, setExtraName] = useState('');
  const [extraEmail, setExtraEmail] = useState('');
  const [escalationStages, setEscalationStages] = useState<string[]>(['7d', '3d', '48h']);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const comp = companies.find((c) => c.id === selectedCompanyId);
    if (!comp) return;
    setDirectors(
      comp.directorEmails.map((email, idx) => ({
        uid: comp.directorUids[idx],
        name: comp.directorNames[idx] || email,
        email,
        selected: true,
      }))
    );
  }, [selectedCompanyId, companies]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setErrorMsg('Please select a valid PDF document (.pdf).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg('PDF file must be under 12 MB.');
      return;
    }
    setErrorMsg(null);
    const buffer = await file.arrayBuffer();
    setUploadedPdfBytes(new Uint8Array(buffer));
    setUploadedFileName(file.name);
  };

  const handleAddDirector = () => {
    if (!extraEmail.trim() || !extraEmail.includes('@')) return;
    setDirectors((prev) => [
      ...prev,
      {
        name: extraName.trim() || extraEmail.split('@')[0],
        email: extraEmail.trim().toLowerCase(),
        selected: true,
      },
    ]);
    setExtraName('');
    setExtraEmail('');
  };

  const toggleStage = (stage: string) => {
    setEscalationStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const company = companies.find((c) => c.id === selectedCompanyId);
    if (!company) {
      setErrorMsg('Please select a client company first.');
      return;
    }
    const chosenDirectors = directors.filter((d) => d.selected);
    if (chosenDirectors.length === 0) {
      setErrorMsg('Assign at least one director to execute this resolution.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createResolutionAndNotify(adminUid, {
        title,
        referenceCode,
        company,
        category,
        summary: summary.trim() || `Statutory ${category} for ${company.name}.`,
        bodyText,
        statutoryDueDate,
        uploadedPdfBytes,
        uploadedFileName: uploadedFileName || undefined,
        assignedDirectors: chosenDirectors.map(({ uid, name, email }) => ({ uid, name, email })),
        escalationSchedule: escalationStages,
      });
      onSuccess(
        `Resolution ${referenceCode} assigned to ${chosenDirectors.length} director(s) with instant push notification dispatched.`
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to publish resolution.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-res-title"
    >
      <div className="w-full max-w-2xl max-h-[92vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="upload-res-title" className="text-lg font-bold text-[#0F172A]">
              Upload &amp; Assign Corporate Resolution
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Submitting immediately dispatches push notifications and syncs director app badges.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Company & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="res-co" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Client Company
              </label>
              <select
                id="res-co"
                required
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.uen})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="res-cat" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Resolution Type
              </label>
              <select
                id="res-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as ResolutionCategory)}
                className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="res-title" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Resolution Title
            </label>
            <input
              id="res-title"
              type="text"
              required
              minLength={3}
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Approval of FY2026 Audited Financial Statements"
              className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
            />
          </div>

          {/* Reference Code & Statutory Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="res-ref" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Reference Code
              </label>
              <input
                id="res-ref"
                type="text"
                required
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value.toUpperCase())}
                className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 font-mono text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              />
            </div>

            <div>
              <label htmlFor="res-due" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Statutory Due Date
              </label>
              <input
                id="res-due"
                type="date"
                required
                value={statutoryDueDate}
                onChange={(e) => setStatutoryDueDate(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 font-mono text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              />
            </div>
          </div>

          {/* PDF File Upload */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">
              Resolution PDF Document
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={handleFilePick}
              className="hidden"
            />
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0F172A] truncate">
                  {uploadedFileName || 'Auto-generate formatted PDF from text below'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {uploadedPdfBytes
                    ? `${Math.round(uploadedPdfBytes.length / 1024)} KB PDF attached`
                    : 'Optional: Upload an external PDF resolution prepared by counsel'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="min-h-[38px] px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0F172A] hover:bg-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                {uploadedPdfBytes ? 'Replace PDF' : 'Upload PDF'}
              </button>
            </div>
          </div>

          {/* Summary & Legal Body */}
          <div>
            <label htmlFor="res-summary" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Executive Summary (shown on Director Mobile card)
            </label>
            <input
              id="res-summary"
              type="text"
              required
              minLength={5}
              maxLength={400}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Concise 1-sentence summary for board directors"
              className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
            />
          </div>

          {!uploadedPdfBytes && (
            <div>
              <label htmlFor="res-body" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Resolution Clauses (rendered into generated PDF)
              </label>
              <textarea
                id="res-body"
                rows={4}
                required
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 text-xs font-mono leading-relaxed text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
              />
            </div>
          )}

          {/* Assign Directors */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <span className="block text-xs font-semibold text-slate-700">
              Assigned Directors (Signatories)
            </span>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {directors.map((dir, idx) => (
                <label
                  key={`${dir.email}-${idx}`}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={dir.selected}
                      onChange={() =>
                        setDirectors((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, selected: !item.selected } : item
                          )
                        )
                      }
                      className="w-4 h-4 accent-[#0F172A]"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] truncate">{dir.name}</p>
                      <p className="text-xs text-slate-500 truncate">{dir.email}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                placeholder="Co-director name"
                className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs text-[#0F172A]"
              />
              <input
                type="email"
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
                placeholder="co-director@company.com"
                className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs text-[#0F172A]"
              />
              <button
                type="button"
                onClick={handleAddDirector}
                className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-[#0F172A] hover:bg-slate-100 inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Signatory
              </button>
            </div>
          </div>

          {/* Automated Escalation Rules */}
          <div className="pt-2 border-t border-slate-100">
            <span className="block text-xs font-semibold text-slate-700 mb-2">
              Automated Push Escalation Schedule
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                { key: '7d', label: '7 Days Before Deadline' },
                { key: '3d', label: '3 Days Before Deadline' },
                { key: '48h', label: '48 Hours Before Deadline' },
              ].map((stage) => {
                const active = escalationStages.includes(stage.key);
                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => toggleStage(stage.key)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0F172A] border-[#0F172A] text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {stage.label}
                  </button>
                );
              })}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-[#DC2626]">
              {errorMsg}
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 rounded-lg bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-2 cursor-pointer"
            >
              <BellRing className="w-4 h-4" />
              {submitting ? 'Publishing & Notifying...' : 'Publish & Push Notify Directors'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface NewCompanyModalProps {
  adminUid: string;
  adminEmail: string;
  adminName: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const NewCompanyModal: React.FC<NewCompanyModalProps> = ({
  adminUid,
  adminEmail,
  adminName,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [uen, setUen] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Singapore (ACRA)');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [incorporationDate, setIncorporationDate] = useState('2024-01-15');
  const [directors, setDirectors] = useState<Array<{ uid?: string; name: string; email: string }>>([
    { uid: adminUid, name: adminName, email: adminEmail },
  ]);
  const [newDirName, setNewDirName] = useState('');
  const [newDirEmail, setNewDirEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addDir = () => {
    if (!newDirEmail.trim() || !newDirEmail.includes('@')) return;
    setDirectors((prev) => [
      ...prev,
      { name: newDirName.trim() || newDirEmail.split('@')[0], email: newDirEmail.trim().toLowerCase() },
    ]);
    setNewDirName('');
    setNewDirEmail('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (directors.length === 0) {
      setErrorMsg('Please include at least one board director.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createCompany(adminUid, {
        name,
        uen,
        jurisdiction,
        registeredAddress,
        incorporationDate,
        directors,
      });
      onSuccess(`Client company "${name}" added to your secretarial portfolio.`);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create company.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-co-title"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="new-co-title" className="text-lg font-bold text-[#0F172A]">
            Add Client Company
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div>
            <label htmlFor="co-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Registered Legal Name
            </label>
            <input
              id="co-name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apex Maritime Ventures Pte. Ltd."
              className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm text-[#0F172A]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="co-uen" className="block text-xs font-semibold text-slate-700 mb-1">
                UEN / Registration No.
              </label>
              <input
                id="co-uen"
                required
                value={uen}
                onChange={(e) => setUen(e.target.value.toUpperCase())}
                placeholder="202418902W"
                className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 font-mono text-sm text-[#0F172A]"
              />
            </div>
            <div>
              <label htmlFor="co-inc" className="block text-xs font-semibold text-slate-700 mb-1">
                Incorporation Date
              </label>
              <input
                id="co-inc"
                type="date"
                required
                value={incorporationDate}
                onChange={(e) => setIncorporationDate(e.target.value)}
                className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 font-mono text-sm text-[#0F172A]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="co-jur" className="block text-xs font-semibold text-slate-700 mb-1">
              Jurisdiction &amp; Registry
            </label>
            <input
              id="co-jur"
              required
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm text-[#0F172A]"
            />
          </div>

          <div>
            <label htmlFor="co-addr" className="block text-xs font-semibold text-slate-700 mb-1">
              Registered Office Address
            </label>
            <input
              id="co-addr"
              required
              minLength={5}
              value={registeredAddress}
              onChange={(e) => setRegisteredAddress(e.target.value)}
              placeholder="1 Raffles Place, #28-01, Singapore 048616"
              className="w-full min-h-[42px] px-3.5 rounded-lg border border-slate-300 text-sm text-[#0F172A]"
            />
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2.5">
            <span className="block text-xs font-semibold text-slate-700">Board Directors</span>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {directors.map((d, i) => (
                <li key={i} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0F172A] truncate">{d.name}</p>
                    <p className="text-slate-500 truncate">{d.email}</p>
                  </div>
                  {directors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDirectors((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-slate-400 hover:text-[#DC2626] p-1 cursor-pointer"
                      aria-label="Remove director"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                placeholder="Director Name"
                className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="email"
                value={newDirEmail}
                onChange={(e) => setNewDirEmail(e.target.value)}
                placeholder="email@company.com"
                className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs"
              />
              <button
                type="button"
                onClick={addDir}
                className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-[#DC2626]">
              {errorMsg}
            </div>
          )}

          <div className="pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 rounded-lg bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Saving...' : 'Save Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
