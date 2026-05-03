
/**
 * Structured Logger
 * 
 * Centralized logging service that:
 * 1. Formats logs consistently (JSON-ready structure)
 * 2. Captures context (User ID, Correlation ID)
 * 3. Supports log levels
 * 4. Prepares us for remote logging (e.g. Sentry/Datadog) in implementation
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
    correlationId?: string;
    action?: string;
    component?: string;
    [key: string]: unknown;
}

class LoggerService {
    private static instance: LoggerService;
    private isDev: boolean;

    private constructor() {
        // Simple check for dev environment
        this.isDev = import.meta.env?.DEV ?? true;
    }

    static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }

    private format(level: LogLevel, message: string, context?: LogContext): string {
        const timestamp = new Date().toISOString();
        const correlation = context?.correlationId ? `[${context.correlationId}]` : '';
        return `[${timestamp}] ${level} ${correlation} ${message}`;
    }

    private print(level: LogLevel, message: string, context?: LogContext, error?: Error) {
        const text = this.format(level, message, context);
        const data = context ? { ...context } : undefined;

        switch (level) {
            case 'DEBUG':
                if (this.isDev) console.debug(text, data);
                break;
            case 'INFO':
                console.info(text, data);
                break;
            case 'WARN':
                console.warn(text, data);
                break;
            case 'ERROR':
                console.error(text, data, error);
                break;
        }
    }

    debug(message: string, context?: LogContext) {
        this.print('DEBUG', message, context);
    }

    info(message: string, context?: LogContext) {
        this.print('INFO', message, context);
    }

    warn(message: string, context?: LogContext) {
        this.print('WARN', message, context);
    }

    error(message: string, error?: Error | unknown, context?: LogContext) {
        this.print('ERROR', message, context, error instanceof Error ? error : new Error(String(error)));
    }
}

export const logger = LoggerService.getInstance();
