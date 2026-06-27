/**
 * PasswordField — reusable password input with show/hide toggle.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 *
 * - Hidden by default (type="password").
 * - Eye icon toggle switches between type="password" and type="text".
 * - Value and onChange are controlled externally (no internal value state).
 * - Accessible: button aria-label toggles between "Show password" / "Hide password".
 * - Reuses existing auth input classes (no new visual style).
 * - Right padding prevents text from overlapping the icon button.
 * - Font: DM Sans for English/inputs (project font rule).
 */

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface PasswordFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    autoComplete?: string;
}

const PasswordField: React.FC<PasswordFieldProps> = ({
    id,
    label,
    value,
    onChange,
    disabled = false,
    autoComplete = 'current-password',
}) => {
    const [isVisible, setIsVisible] = useState(false);

    const toggleVisibility = () => {
        setIsVisible(prev => !prev);
    };

    return (
        <div className="space-y-1">
            <label
                htmlFor={id}
                className="block text-xs font-semibold text-stone-600 uppercase tracking-wide"
            >
                {label}
            </label>
            <div className="relative">
                <input
                    id={id}
                    type={isVisible ? 'text' : 'password'}
                    autoComplete={autoComplete}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 pr-10 text-sm font-medium outline-none focus:ring-2 focus:border-emerald-400 focus:ring-emerald-200/60"
                    disabled={disabled}
                />
                <button
                    type="button"
                    aria-label={isVisible ? 'Hide password' : 'Show password'}
                    onClick={toggleVisibility}
                    disabled={disabled}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-stone-600 disabled:opacity-50"
                    tabIndex={-1}
                >
                    {isVisible ? (
                        <EyeOff size={16} aria-hidden="true" />
                    ) : (
                        <Eye size={16} aria-hidden="true" />
                    )}
                </button>
            </div>
        </div>
    );
};

export default PasswordField;
