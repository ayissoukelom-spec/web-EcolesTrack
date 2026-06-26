import React from 'react';

type State = { hasError: boolean; error?: Error | null };

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  public state: State;

  constructor(props: any) {
    super(props as any);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-lg text-rose-800">
          <h4 className="font-bold">Une erreur est survenue dans le module Administration</h4>
          <p className="text-sm mt-2">{this.state.error?.message || 'Erreur inconnue'}</p>
        </div>
      );
    }
    return (this as any).props.children;
  }
}
