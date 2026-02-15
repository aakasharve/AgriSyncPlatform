
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../../../infrastructure/observability/Logger';
import { CorrelationId } from '../../../infrastructure/observability/CorrelationContext';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorId: string;
}

/**
 * AppErrorBoundary
 * 
 * Top-level error catcher.
 * Prevents white screen of death.
 * Logs error to infrastructure.
 * Provides user with "Reload" and "Copy Error ID" options.
 */
export class AppErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorId: ''
        };
    }

    public static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            error,
            errorId: CorrelationId.generate() // Generate distinct ID for this crash
        };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logger.error('Uncaught UI Error', error, {
            errorId: this.state.errorId,
            componentStack: errorInfo.componentStack
        });
    }

    private handleReload = () => {
        window.location.reload();
    };

    private handleCopyError = () => {
        const report = `Error ID: ${this.state.errorId}\nMessage: ${this.state.error?.message}\nTime: ${new Date().toISOString()}`;
        navigator.clipboard.writeText(report);
        alert('Error report copied to clipboard');
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                    <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center border border-gray-200">
                        <div className="mb-6 flex justify-center">
                            <div className="h-16 w-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-3xl">
                                ⚠️
                            </div>
                        </div>

                        <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
                        <p className="text-gray-600 mb-6">
                            The application encountered an unexpected error.
                        </p>

                        <div className="bg-gray-100 rounded p-3 mb-6 text-left overflow-auto max-h-32">
                            <code className="text-xs text-red-600 font-mono">
                                {this.state.error?.message}
                            </code>
                            <div className="text-xs text-gray-500 mt-1">Ref: {this.state.errorId}</div>
                        </div>

                        <div className="space-y-3">
                            <button
                                onClick={this.handleReload}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                            >
                                Reload Application
                            </button>

                            <button
                                onClick={this.handleCopyError}
                                className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Copy Error Report
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
