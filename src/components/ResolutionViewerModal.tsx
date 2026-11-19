import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Camera,
  CheckCircle2,
  Download,
  FileText,
  PenTool,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Resolution, ResolutionSignature, SignatureMethod } from '../types';
import { SignatureCanvas } from './SignatureCanvas';
import { getDeadlineMetrics, hasDirectorSigned } from '../lib/escalation';
import { generateResolutionPdfBytes, stampSignatureOnPdfBytes } from '../lib/pdfEngine';
import { uploadDocumentFile } from '../lib/firebase';
import {
  markResolutionViewed,
  signResolutionAtomically,
  subscribeResolutionSignatures,
} from '../lib/firestoreService';

interface Props {
  resolution: Resolution;
  user: User;
  directorName: string;
  isAdminView: boolean;
  onClose: () => void;
  onSignedSuccess?: (resolutionTitle: string) => void;
}

async function compressImageFileToDataUrl(file: File, maxDim = 960): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => reject(new Error('Could not decode uploaded scan image.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export const ResolutionViewerModal: React.FC<Props> = ({
  resolution,
  user,
  directorName,
  isAdminView,
  onClose,
  onSignedSuccess,
}) => {
  const [activeView, setActiveView] = useState<'document' | 'sign'>('document');
  const [signingMethod, setSigningMethod] = useState<SignatureMethod>('e-signature');
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null);
  const [wetInkPreview, setWetInkPreview] = useState<string | null>(null);
  const [wetInkFileName, setWetInkFileName] = useState<string>('');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBytesCache, setPdfBytesCache] = useState<Uint8Array | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<ResolutionSignature[]>([]);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const metrics = getDeadlineMetrics(resolution.statutoryDueDate, resolution.status);
  const alreadySignedByMe = hasDirectorSigned(resolution, user.uid, user.email);
  const canSign = !isAdminView && !alreadySignedByMe && resolution.status !== 'signed';

  // Record "viewed" status automatically when an assigned director opens the document
  useEffect(() => {
    if (!isAdminView && resolution.status !== 'signed') {
      markResolutionViewed(resolution, user).catch(() => {});
    }
  }, [isAdminView, resolution, user]);

  // Subscribe to signature audit records
  useEffect(() => {
    const unsub = subscribeResolutionSignatures(
      resolution.id,
      user,
      isAdminView,
      setSignatures
    );
    return () => unsub();
  }, [resolution.id, user, isAdminView]);

  // Load real PDF bytes (from stored URL or regenerate cleanly via pdf-lib if unavailable)
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    async function loadPdf() {
      setLoadingPdf(true);
      try {
        let bytes: Uint8Array | null = null;
        if (resolution.pdfUrl) {
          const resp = await fetch(resolution.pdfUrl);
          if (resp.ok) {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('pdf') || resolution.pdfUrl.endsWith('.pdf')) {
              bytes = new Uint8Array(await resp.arrayBuffer());
            }
          }
        }
        if (!bytes) {
          bytes = await generateResolutionPdfBytes({
            referenceCode: resolution.referenceCode,
            companyName: resolution.companyName,
            category: resolution.category,
            title: resolution.title,
            statutoryDueDate: resolution.statutoryDueDate,
            summary: resolution.summary,
            bodyText: resolution.bodyText,
            directorNames: resolution.assignedDirectorNames,
          });
        }
        if (!active) return;
        setPdfBytesCache(bytes);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(objectUrl);
      } catch {
        if (active) setErrorMsg('Unable to render PDF preview; displaying resolution text below.');
      } finally {
        if (active) setLoadingPdf(false);
      }
    }

    loadPdf();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolution]);

  const handleWetInkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setWetInkFileName(file.name);
    try {
      if (file.type === 'application/pdf') {
        // Render a clean stamped confirmation badge image for PDF wet-ink upload
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 180;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 480, 180);
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 3;
        ctx.strokeRect(12, 12, 456, 156);
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('WET-INK SIGNED SCAN UPLOADED', 36, 74);
        ctx.fillStyle = '#475569';
        ctx.font = '14px monospace';
        ctx.fillText(file.name.slice(0, 44), 36, 110);
        ctx.fillText(`Uploaded by ${directorName}`, 36, 138);
        setWetInkPreview(canvas.toDataURL('image/png'));
      } else {
        const compressed = await compressImageFileToDataUrl(file);
        setWetInkPreview(compressed);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process wet-ink scan.');
    }
  };

  const handleExecuteSignature = async () => {
    const sigImage = signingMethod === 'e-signature' ? drawnDataUrl : wetInkPreview;
    if (!sigImage) {
      setErrorMsg(
        signingMethod === 'e-signature'
          ? 'Please draw your signature before submitting.'
          : 'Please capture or upload a wet-ink scan before submitting.'
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const baseBytes =
        pdfBytesCache ||
        (await generateResolutionPdfBytes({
          referenceCode: resolution.referenceCode,
          companyName: resolution.companyName,
          category: resolution.category,
          title: resolution.title,
          statutoryDueDate: resolution.statutoryDueDate,
          summary: resolution.summary,
          bodyText: resolution.bodyText,
          directorNames: resolution.assignedDirectorNames,
        }));

      const stampedBytes = await stampSignatureOnPdfBytes(baseBytes, {
        directorName,
        directorEmail: user.email || `${user.uid}@director.quorumseal.local`,
        method: signingMethod,
        signatureImageDataUrl: sigImage,
        signedAtIso: new Date().toISOString(),
        slotIndex: Math.max(resolution.signedByUids.length, resolution.signedByEmails.length),
        referenceCode: resolution.referenceCode,
      });

      const stampedName = `${resolution.referenceCode}_signed_${Date.now()}.pdf`;
      const { url: stampedPdfUrl } = await uploadDocumentFile(
        stampedBytes,
        stampedName,
        'application/pdf'
      );

      await signResolutionAtomically({
        resolution,
        user,
        directorName,
        method: signingMethod,
        signatureDataUrl: sigImage,
        stampedPdfUrl,
      });

      onSignedSuccess?.(resolution.title);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to complete signature. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const signedCount = Math.max(resolution.signedByUids.length, resolution.signedByEmails.length);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#F8FAFC] md:bg-slate-950/60 md:backdrop-blur-xs md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolution-modal-title"
    >
      <div className="w-full h-full md:h-[90vh] md:max-w-5xl bg-white md:rounded-2xl md:border md:border-slate-200 flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-medium text-[#0F172A]">{resolution.referenceCode}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{resolution.companyName}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  metrics.isOverdue
                    ? 'font-semibold text-[#DC2626]'
                    : resolution.status === 'signed'
                      ? 'font-semibold text-[#059669]'
                      : 'font-semibold text-[#D97706]'
                }
              >
                {metrics.countdownLabel}
              </span>
            </div>
            <h2
              id="resolution-modal-title"
              className="text-base md:text-lg font-bold text-[#0F172A] truncate mt-0.5"
            >
              {resolution.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pdfBlobUrl && (
              <a
                href={pdfBlobUrl}
                download={resolution.pdfFileName || `${resolution.referenceCode}.pdf`}
                className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download PDF</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0F172A] cursor-pointer"
              aria-label="Close resolution viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Bar (Mobile & Desktop) */}
        <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveView('document')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeView === 'document'
                  ? 'bg-white text-[#0F172A] shadow-2xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              Resolution PDF
            </button>
            {canSign && (
              <button
                type="button"
                onClick={() => setActiveView('sign')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  activeView === 'sign'
                    ? 'bg-white text-[#0F172A] shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                Execute Signature
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="tabular-nums font-medium">
              {signedCount} of {resolution.requiredSignatures} Directors signed
            </span>
          </div>
        </div>

        {/* Main Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {activeView === 'document' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 h-full">
              {/* Embedded PDF Viewer */}
              <div className="lg:col-span-8 bg-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 min-h-[420px] flex flex-col">
                {loadingPdf ? (
                  <div className="flex-1 flex items-center justify-center p-10 text-sm text-slate-500">
                    Preparing statutory PDF document...
                  </div>
                ) : pdfBlobUrl ? (
                  <iframe
                    src={`${pdfBlobUrl}#toolbar=0&navpanes=0`}
                    title={resolution.title}
                    className="w-full flex-1 min-h-[440px] lg:min-h-full bg-white"
                  />
                ) : (
                  <div className="p-6 bg-white m-4 rounded-xl border border-slate-200 whitespace-pre-wrap text-sm leading-relaxed text-[#0F172A]">
                    {resolution.bodyText}
                  </div>
                )}
              </div>

              {/* Right Audit & Director Status Rail */}
              <div className="lg:col-span-4 p-5 space-y-6 bg-white">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2">
                    Resolution Summary
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed">{resolution.summary}</p>
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Category</span>
                    <span className="font-medium text-[#0F172A]">{resolution.category}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Statutory Deadline</span>
                    <span className="font-mono font-medium text-[#0F172A] tabular-nums">
                      {resolution.statutoryDueDate}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Escalation Rules</span>
                    <span className="font-mono text-[#0F172A]">
                      {(resolution.escalationSchedule || ['7d', '3d', '48h']).join(' / ')}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <h3 className="text-xs font-semibold text-slate-500 mb-3">
                    Board Signatory Roster
                  </h3>
                  <ul className="divide-y divide-slate-100">
                    {resolution.assignedDirectorEmails.map((email, idx) => {
                      const name = resolution.assignedDirectorNames[idx] || email;
                      const isSigned = resolution.signedByEmails.some(
                        (e) => e.toLowerCase() === email.toLowerCase()
                      );
                      return (
                        <li key={email} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#0F172A] truncate">{name}</p>
                            <p className="text-xs text-slate-500 truncate">{email}</p>
                          </div>
                          <span
                            className={`text-xs font-semibold whitespace-nowrap ${
                              isSigned ? 'text-[#059669]' : 'text-[#D97706]'
                            }`}
                          >
                            {isSigned ? 'Signed' : 'Pending'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {signatures.length > 0 && (
                  <div className="pt-4 border-t border-slate-100">
                    <h3 className="text-xs font-semibold text-slate-500 mb-3">
                      Recorded Signature Proofs
                    </h3>
                    <div className="space-y-3">
                      {signatures.map((sig) => (
                        <div
                          key={sig.id}
                          className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#0F172A]">{sig.directorName}</span>
                            <span className="text-[#059669] font-medium">
                              {sig.method === 'e-signature' ? 'E-Signature' : 'Wet-Ink Scan'}
                            </span>
                          </div>
                          {sig.signatureDataUrl && (
                            <img
                              src={sig.signatureDataUrl}
                              alt={`Signature of ${sig.directorName}`}
                              referrerPolicy="no-referrer"
                              className="h-14 w-full object-contain bg-white rounded border border-slate-200 p-1"
                            />
                          )}
                          <p className="text-[11px] font-mono text-slate-500">{sig.deviceNote}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {alreadySignedByMe && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-sm text-[#059669] font-medium">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Your signature has been recorded and stamped onto the PDF.</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Execution / Signing Interface */
            <div className="max-w-xl mx-auto p-5 md:p-8 space-y-6">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A]">
                  Execute Corporate Resolution
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Choose your preferred execution method. Your signature and UTC timestamp will be permanently stamped onto the resolution PDF.
                </p>
              </div>

              {/* Method A vs Method B Segmented Selector */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSigningMethod('e-signature');
                    setErrorMsg(null);
                  }}
                  className={`min-h-[64px] p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    signingMethod === 'e-signature'
                      ? 'border-[#0F172A] bg-[#0F172A] text-white'
                      : 'border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <PenTool className="w-4 h-4 shrink-0" />
                    <span>Draw E-Signature</span>
                  </div>
                  <p
                    className={`text-xs mt-1 ${
                      signingMethod === 'e-signature' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    Smooth touch canvas stamped to PDF
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSigningMethod('wet-ink-scan');
                    setErrorMsg(null);
                  }}
                  className={`min-h-[64px] p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    signingMethod === 'wet-ink-scan'
                      ? 'border-[#0F172A] bg-[#0F172A] text-white'
                      : 'border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>Upload Wet-Ink Scan</span>
                  </div>
                  <p
                    className={`text-xs mt-1 ${
                      signingMethod === 'wet-ink-scan' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    Phone camera capture or file upload
                  </p>
                </button>
              </div>

              {signingMethod === 'e-signature' ? (
                <SignatureCanvas onSignatureChange={setDrawnDataUrl} />
              ) : (
                <div className="space-y-4">
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleWetInkFile}
                    className="hidden"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleWetInkFile}
                    className="hidden"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="min-h-[52px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center gap-2 text-sm font-semibold text-[#0F172A] cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      Capture with Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[52px] px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center gap-2 text-sm font-semibold text-[#0F172A] cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      Choose Scan / File
                    </button>
                  </div>

                  {wetInkPreview && (
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="font-medium flex items-center gap-1.5 truncate">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          {wetInkFileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setWetInkPreview(null);
                            setWetInkFileName('');
                          }}
                          className="text-[#DC2626] font-medium cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                      <img
                        src={wetInkPreview}
                        alt="Wet-ink scan preview"
                        referrerPolicy="no-referrer"
                        className="w-full max-h-52 object-contain bg-white rounded-lg border border-slate-200 p-2"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Legal Attestation */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                By tapping <strong className="text-[#0F172A]">Confirm &amp; Stamp Resolution</strong>,{' '}
                <strong className="text-[#0F172A]">{directorName}</strong> confirms having read{' '}
                <span className="font-mono">{resolution.referenceCode}</span> in full and consents to execute this corporate resolution electronically in accordance with the Company&apos;s Constitution.
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-[#DC2626]">
                  {errorMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Bottom Action Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white pb-safe flex items-center justify-between gap-3 shrink-0">
          {activeView === 'document' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              {canSign && (
                <button
                  type="button"
                  onClick={() => setActiveView('sign')}
                  className="flex-1 sm:flex-none min-h-[44px] px-6 py-2.5 rounded-xl bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <PenTool className="w-4 h-4" />
                  Proceed to Sign Resolution
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveView('document')}
                disabled={submitting}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Back to PDF
              </button>
              <button
                type="button"
                onClick={handleExecuteSignature}
                disabled={submitting}
                className="flex-1 sm:flex-none min-h-[44px] px-6 py-2.5 rounded-xl bg-[#059669] text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                {submitting ? 'Stamping PDF & Recording...' : 'Confirm & Stamp Resolution'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
