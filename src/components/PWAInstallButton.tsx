import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  variant?: 'compact' | 'banner';
}

export const PWAInstallButton: React.FC<Props> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'banner'
            ? 'w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#0F172A] text-white text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer'
            : 'inline-flex items-center gap-2 min-h-[38px] px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-[#0F172A] text-xs font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer'
        }
      >
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Download className="w-4 h-4 shrink-0" />
          {isIOS ? 'Install on iPhone / iPad' : 'Install Mobile App'}
        </span>
        {variant === 'banner' && (
          <span className="text-xs text-slate-300 font-normal whitespace-nowrap">
            iOS &amp; Android PWA
          </span>
        )}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="pwa-install-title" className="text-base font-bold text-[#0F172A]">
                Install QuorumSeal App
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-3 text-sm text-slate-600 leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#0F172A] mt-0.5">01.</span>
                  <span>
                    Tap the <strong className="text-[#0F172A] inline-flex items-center gap-1">Share <Share className="w-3.5 h-3.5 inline" /></strong> button in Safari&apos;s toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#0F172A] mt-0.5">02.</span>
                  <span>
                    Scroll down and select <strong className="text-[#0F172A]">Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#0F172A] mt-0.5">03.</span>
                  <span>
                    Open QuorumSeal from your home screen to enable persistent app icon badges and push alerts.
                  </span>
                </li>
              </ol>
            ) : (
              <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
                <p>
                  Open this page in Chrome, Edge, or Safari on your phone and choose{' '}
                  <strong className="text-[#0F172A]">Install App</strong> or{' '}
                  <strong className="text-[#0F172A]">Add to Home Screen</strong> from the browser menu.
                </p>
                <p className="text-xs text-slate-500">
                  Once installed, QuorumSeal runs in standalone native mode and syncs unsigned resolution counts directly to your app icon badge.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 w-full min-h-[44px] rounded-xl bg-[#0F172A] text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
