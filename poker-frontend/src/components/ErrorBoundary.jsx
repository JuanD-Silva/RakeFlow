import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center bg-red-900/10 border border-red-500/20 rounded-xl p-8 m-4">
          <p className="text-red-300 text-lg font-bold mb-2">Algo salio mal</p>
          <p className="text-gray-400 text-sm mb-4 text-center max-w-md">
            {this.state.error?.message || 'Error inesperado en este componente.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-lg transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
