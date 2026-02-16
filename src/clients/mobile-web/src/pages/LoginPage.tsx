import React, { useState } from 'react';
import { useAuth } from '../app/providers/AuthProvider';

interface LoginPageProps { }

const LoginPage: React.FC<LoginPageProps> = () => {
    const { login, isLoading, loginError } = useAuth();
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!phone.trim() || !password.trim()) {
            return;
        }

        try {
            await login(phone.trim(), password);
        } catch {
            // Error is surfaced by AuthProvider state.
        }
    };

    return (
        <div className="min-h-screen bg-surface-100 bg-subtle-mesh text-stone-900 flex items-center justify-center px-4">
            <div className="w-full max-w-sm glass-panel p-6 space-y-5 shadow-xl border border-stone-200/70">
                <div className="space-y-1 text-center">
                    <h1 className="text-2xl font-black font-display text-stone-800">ShramSafal Login</h1>
                    <p className="text-xs text-stone-500 font-medium">
                        Real mode uses AgriSync backend authentication.
                    </p>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-1">
                        <label htmlFor="login-phone" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                            Phone
                        </label>
                        <input
                            id="login-phone"
                            type="tel"
                            autoComplete="username"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="9876543210"
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                            disabled={isLoading}
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="login-password" className="block text-xs font-semibold text-stone-600 uppercase tracking-wide">
                            Password
                        </label>
                        <input
                            id="login-password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/60"
                            disabled={isLoading}
                        />
                    </div>

                    {loginError && (
                        <div className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                            {loginError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-2.5 transition-colors"
                    >
                        {isLoading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-xs text-stone-400">
                        AgriSync Platform v1.0
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
