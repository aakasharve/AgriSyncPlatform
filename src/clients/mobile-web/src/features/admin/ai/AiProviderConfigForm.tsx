import React, { useEffect, useState } from 'react';
import {
    AiProviderConfigResponse,
    UpdateAiProviderConfigRequest,
} from '../../../infrastructure/api/AgriSyncClient';

type ProviderOption = 'Sarvam' | 'Gemini';
type ProviderOverrideOption = ProviderOption | 'AUTO';

interface AiProviderConfigFormProps {
    config: AiProviderConfigResponse;
    isSaving: boolean;
    onSave: (request: UpdateAiProviderConfigRequest) => Promise<void>;
}

interface FormState {
    defaultProvider: ProviderOption;
    fallbackEnabled: boolean;
    isAiProcessingDisabled: boolean;
    maxRetries: string;
    circuitBreakerThreshold: string;
    circuitBreakerResetSeconds: string;
    voiceConfidenceThreshold: string;
    receiptConfidenceThreshold: string;
    voiceProvider: ProviderOverrideOption;
    receiptProvider: ProviderOverrideOption;
    pattiProvider: ProviderOverrideOption;
}

function toOverrideOption(value?: string): ProviderOverrideOption {
    if (value === 'Sarvam' || value === 'Gemini') {
        return value;
    }

    return 'AUTO';
}

function toFormState(config: AiProviderConfigResponse): FormState {
    return {
        defaultProvider: config.defaultProvider as ProviderOption,
        fallbackEnabled: config.fallbackEnabled,
        isAiProcessingDisabled: config.isAiProcessingDisabled,
        maxRetries: String(config.maxRetries),
        circuitBreakerThreshold: String(config.circuitBreakerThreshold),
        circuitBreakerResetSeconds: String(config.circuitBreakerResetSeconds),
        voiceConfidenceThreshold: String(config.voiceConfidenceThreshold),
        receiptConfidenceThreshold: String(config.receiptConfidenceThreshold),
        voiceProvider: toOverrideOption(config.voiceProvider),
        receiptProvider: toOverrideOption(config.receiptProvider),
        pattiProvider: toOverrideOption(config.pattiProvider),
    };
}

function parseInteger(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOverride(value: ProviderOverrideOption): 'Sarvam' | 'Gemini' | null {
    return value === 'AUTO' ? null : value;
}

export const AiProviderConfigForm: React.FC<AiProviderConfigFormProps> = ({
    config,
    isSaving,
    onSave,
}) => {
    const [form, setForm] = useState<FormState>(() => toFormState(config));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm(toFormState(config));
        setError(null);
    }, [config]);

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        const request: UpdateAiProviderConfigRequest = {
            defaultProvider: form.defaultProvider,
            fallbackEnabled: form.fallbackEnabled,
            isAiProcessingDisabled: form.isAiProcessingDisabled,
            maxRetries: Math.max(1, parseInteger(form.maxRetries, config.maxRetries)),
            circuitBreakerThreshold: Math.max(1, parseInteger(form.circuitBreakerThreshold, config.circuitBreakerThreshold)),
            circuitBreakerResetSeconds: Math.max(10, parseInteger(form.circuitBreakerResetSeconds, config.circuitBreakerResetSeconds)),
            voiceConfidenceThreshold: Math.max(0, Math.min(1, parseFloatValue(form.voiceConfidenceThreshold, config.voiceConfidenceThreshold))),
            receiptConfidenceThreshold: Math.max(0, Math.min(1, parseFloatValue(form.receiptConfidenceThreshold, config.receiptConfidenceThreshold))),
            voiceProvider: parseOverride(form.voiceProvider),
            receiptProvider: parseOverride(form.receiptProvider),
            pattiProvider: parseOverride(form.pattiProvider),
        };

        try {
            await onSave(request);
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : 'Failed to update provider configuration.';
            setError(message);
        }
    };

    return (
        <form onSubmit={submit} className="glass-panel p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-stone-800">Provider Policy</h2>
                    <p className="text-xs text-stone-500">Admin-only controls for routing and fallback behavior.</p>
                </div>
                <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-60"
                >
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>

            {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            )}

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                Voice: {config.resolvedVoiceProvider ?? config.voiceProvider ?? config.defaultProvider}
                {' | '}Receipt: {config.resolvedReceiptProvider ?? config.receiptProvider ?? config.defaultProvider}
                {' | '}Patti: {config.resolvedPattiProvider ?? config.pattiProvider ?? config.defaultProvider}
                {config.geminiModelId ? ` | Gemini model: ${config.geminiModelId}` : ''}
            </div>

            <div className="grid grid-cols-1 gap-3">
                <label className="text-sm font-semibold text-stone-700">
                    Default Provider
                    <select
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                        value={form.defaultProvider}
                        onChange={event => update('defaultProvider', event.target.value as ProviderOption)}
                    >
                        <option value="Gemini">Gemini</option>
                        <option value="Sarvam">Sarvam</option>
                    </select>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm font-semibold text-stone-700">
                        Max Retries
                        <input
                            type="number"
                            min={1}
                            max={8}
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.maxRetries}
                            onChange={event => update('maxRetries', event.target.value)}
                        />
                    </label>
                    <label className="text-sm font-semibold text-stone-700">
                        Breaker Threshold
                        <input
                            type="number"
                            min={1}
                            max={20}
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.circuitBreakerThreshold}
                            onChange={event => update('circuitBreakerThreshold', event.target.value)}
                        />
                    </label>
                </div>

                <label className="text-sm font-semibold text-stone-700">
                    Breaker Reset Seconds
                    <input
                        type="number"
                        min={10}
                        max={3600}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                        value={form.circuitBreakerResetSeconds}
                        onChange={event => update('circuitBreakerResetSeconds', event.target.value)}
                    />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm font-semibold text-stone-700">
                        Voice Confidence Threshold
                        <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.voiceConfidenceThreshold}
                            onChange={event => update('voiceConfidenceThreshold', event.target.value)}
                        />
                    </label>
                    <label className="text-sm font-semibold text-stone-700">
                        Receipt Confidence Threshold
                        <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.receiptConfidenceThreshold}
                            onChange={event => update('receiptConfidenceThreshold', event.target.value)}
                        />
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="text-sm font-semibold text-stone-700">
                        Voice Override
                        <select
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.voiceProvider}
                            onChange={event => update('voiceProvider', event.target.value as ProviderOverrideOption)}
                        >
                            <option value="AUTO">Auto</option>
                            <option value="Gemini">Gemini</option>
                            <option value="Sarvam">Sarvam</option>
                        </select>
                    </label>
                    <label className="text-sm font-semibold text-stone-700">
                        Receipt Override
                        <select
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.receiptProvider}
                            onChange={event => update('receiptProvider', event.target.value as ProviderOverrideOption)}
                        >
                            <option value="AUTO">Auto</option>
                            <option value="Gemini">Gemini</option>
                            <option value="Sarvam">Sarvam</option>
                        </select>
                    </label>
                    <label className="text-sm font-semibold text-stone-700">
                        Patti Override
                        <select
                            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                            value={form.pattiProvider}
                            onChange={event => update('pattiProvider', event.target.value as ProviderOverrideOption)}
                        >
                            <option value="AUTO">Auto</option>
                            <option value="Gemini">Gemini</option>
                            <option value="Sarvam">Sarvam</option>
                        </select>
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                        <input
                            type="checkbox"
                            checked={form.fallbackEnabled}
                            onChange={event => update('fallbackEnabled', event.target.checked)}
                        />
                        <span className="text-sm font-semibold text-stone-700">Fallback Enabled</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                        <input
                            type="checkbox"
                            checked={form.isAiProcessingDisabled}
                            onChange={event => update('isAiProcessingDisabled', event.target.checked)}
                        />
                        <span className="text-sm font-semibold text-stone-700">Disable AI Processing</span>
                    </label>
                </div>
            </div>
        </form>
    );
};
