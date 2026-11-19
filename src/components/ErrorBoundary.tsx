import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('QuorumSeal ErrorBoundary caught:', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendlyDetail = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed.error) {
        friendlyDetail = `${parsed.error} (${parsed.operationType || 'operation'} on ${parsed.path || 'Firestore'})`;
      }
    } catch {
      // Plain error message
    }

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 text-[#DC2626] mb-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="text-base font-semibold text-[#0F172A]">
              Application Protection Triggered
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mb-5 break-words">
            {friendlyDetail}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F172A] text-white text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            Reload Workspace
          </button>
        </div>
      </div>
    );
  }
}
