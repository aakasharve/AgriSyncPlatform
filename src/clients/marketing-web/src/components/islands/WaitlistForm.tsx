import { useState } from 'react';

interface WaitlistTranslations {
  title: string;
  phone_label: string;
  phone_placeholder: string;
  submit: string;
  success: string;
  error: string;
}

interface WaitlistFormProps {
  lang: 'en' | 'mr';
  translations: WaitlistTranslations;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const PHONE_REGEX = /^[6-9]\d{9}$/;

export default function WaitlistForm({ lang, translations }: WaitlistFormProps) {
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [touched, setTouched] = useState(false);

  const isValid = PHONE_REGEX.test(phone);
  const showError = touched && phone.length > 0 && !isValid;

  const handleSubmit = async (event: { preventDefault(): void }) => {
    event.preventDefault();

    if (!isValid) {
      setTouched(true);
      return;
    }

    setState('submitting');

    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setState('success');
    } catch {
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <>
        <style>{`
          .waitlist-success {
            text-align: center;
          }
        `}</style>

        <div id="waitlist" className="waitlist-success max-w-md mx-auto px-5 py-10">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-lg font-bold text-white">{translations.success}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        .seedling-input-shell {
          position: relative;
        }

        .seedling-frame {
          position: relative;
        }

        .seedling-root,
        .seedling-stem,
        .seedling-leaf {
          position: absolute;
          pointer-events: none;
          transition: transform 0.3s ease, opacity 0.3s ease, height 0.3s ease;
        }

        .seedling-root {
          left: 18px;
          right: 18px;
          bottom: -8px;
          height: 10px;
          border-radius: 999px;
          background: radial-gradient(circle at center, rgba(16, 185, 129, 0.18), transparent 70%);
          opacity: 0.45;
        }

        .seedling-stem {
          left: 24px;
          bottom: -2px;
          width: 2px;
          height: 0;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(74, 222, 128, 0.28), rgba(22, 163, 74, 0.92));
        }

        .seedling-leaf {
          bottom: 8px;
          width: 12px;
          height: 7px;
          background: linear-gradient(180deg, rgba(74, 222, 128, 0.94), rgba(22, 163, 74, 0.72));
          opacity: 0;
        }

        .seedling-leaf--left {
          left: 14px;
          border-radius: 100% 0 100% 0;
          transform: rotate(-24deg) scale(0.7);
        }

        .seedling-leaf--right {
          left: 25px;
          border-radius: 0 100% 0 100%;
          transform: rotate(24deg) scale(0.7);
        }

        .seedling-input-shell:focus-within .seedling-stem {
          height: 18px;
        }

        .seedling-input-shell:focus-within .seedling-leaf {
          opacity: 1;
        }

        .seedling-input-shell:focus-within .seedling-leaf--left {
          transform: rotate(-24deg) scale(1);
        }

        .seedling-input-shell:focus-within .seedling-leaf--right {
          transform: rotate(24deg) scale(1);
        }

        .vine-underline-trigger {
          position: relative;
          overflow: hidden;
        }

        .vine-underline {
          position: absolute;
          left: 14%;
          right: 14%;
          bottom: 10px;
          height: 14px;
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 0.3s ease, transform 0.3s ease;
          pointer-events: none;
        }

        .vine-underline path {
          stroke-dasharray: 120;
          stroke-dashoffset: 120;
          transition: stroke-dashoffset 0.55s ease;
        }

        .vine-underline-trigger:hover .vine-underline,
        .vine-underline-trigger:focus-visible .vine-underline {
          opacity: 1;
          transform: translateY(0);
        }

        .vine-underline-trigger:hover .vine-underline path,
        .vine-underline-trigger:focus-visible .vine-underline path {
          stroke-dashoffset: 0;
        }

        @media (prefers-reduced-motion: reduce) {
          .seedling-stem,
          .seedling-leaf,
          .vine-underline {
            transition: none;
          }

          .seedling-stem {
            height: 18px;
          }

          .seedling-leaf {
            opacity: 1;
          }

          .vine-underline {
            display: none;
          }
        }
      `}</style>

      <div id="waitlist" className="max-w-md mx-auto px-5 py-10" data-lang={lang}>
        <h3 className="text-center text-lg font-bold text-white mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          {translations.title}
        </h3>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="waitlist-phone" className="block text-sm font-medium text-white/80 mb-1.5">
              {translations.phone_label}
            </label>

            <div className="seedling-input-shell">
              <div className="seedling-frame relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm select-none">
                  +91
                </span>

                <input
                  id="waitlist-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(event) => {
                    const cleaned = event.target.value.replace(/\D/g, '').slice(0, 10);
                    setPhone(cleaned);
                  }}
                  onBlur={() => setTouched(true)}
                  placeholder={translations.phone_placeholder}
                  className={`w-full pl-12 pr-4 py-3 rounded-xl border text-base transition-colors outline-none bg-white/10 text-white placeholder:text-white/40 input-glow ${
                    showError
                      ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-200'
                      : 'border-white/20 focus:border-green-400 focus:ring-1 focus:ring-green-400/30'
                  }`}
                  aria-invalid={showError}
                  aria-describedby={showError ? 'phone-error' : undefined}
                />

                <span className="seedling-root"></span>
                <span className="seedling-stem"></span>
                <span className="seedling-leaf seedling-leaf--left"></span>
                <span className="seedling-leaf seedling-leaf--right"></span>
              </div>
            </div>

            {showError && (
              <p id="phone-error" className="mt-1.5 text-xs text-red-300">
                {translations.error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={state === 'submitting'}
            className="vine-underline-trigger w-full py-3 rounded-xl font-bold text-white text-base transition-all bg-gradient-to-r from-green-600 to-emerald-500 hover:shadow-lg hover:shadow-green-600/20 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {state === 'submitting' ? (
              <span className="inline-flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                ...
              </span>
            ) : (
              <>
                {translations.submit}
                <span className="vine-underline" aria-hidden="true">
                  <svg viewBox="0 0 120 14" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 8 C 16 14, 24 2, 38 8 S 62 14, 74 8 S 96 2, 118 8" fill="none" stroke="rgba(220, 252, 231, 0.9)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
              </>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
