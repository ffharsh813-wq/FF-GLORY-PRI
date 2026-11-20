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
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0D0D0E] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#141416] border border-[#242428] rounded-[20px] p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#2A1B1B] border border-[#4B2626] flex items-center justify-center mx-auto text-red-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold text-white">Application Recovery</h2>
            <p className="text-xs text-[#9A9AA0] break-words">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 rounded-xl bg-[#DEC79B] text-[#141414] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#E7D4AF] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
