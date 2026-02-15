/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = "relative overflow-hidden flex items-center justify-center px-6 py-4 rounded-2xl font-display font-bold text-lg transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.96] hover:-translate-y-0.5";

  const variants = {
    primary: "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white hover:shadow-glow-emerald hover:to-emerald-600 focus:ring-emerald-500/50 shadow-lg shadow-emerald-500/20 border border-emerald-400/20",
    secondary: "bg-surface-100 text-stone-700 border border-stone-200 hover:bg-white hover:border-emerald-200 hover:text-emerald-700 focus:ring-stone-200 shadow-sm hover:shadow-md",
    danger: "bg-gradient-to-br from-red-500 to-red-700 text-white hover:shadow-lg hover:shadow-red-500/30 focus:ring-red-500/50 shadow-md",
    ghost: "bg-transparent text-stone-600 hover:bg-stone-100 hover:text-stone-900"
  };

  // Merge the passed className with the variant style to allow overrides
  const combinedClassName = `${baseStyles} ${variants[variant]} ${className}`;

  return (
    <button
      className={combinedClassName}
      disabled={isLoading || disabled}
      {...props}
    >
      {/* Dynamic Shine Effect on Hover (only for primary) */}
      {variant === 'primary' && !disabled && (
        <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-0 pointer-events-none" />
      )}

      <span className="relative z-10 flex items-center">
        {isLoading ? (
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-currrent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : icon ? (
          <span className="mr-2.5">{icon}</span>
        ) : null}
        {children}
      </span>
    </button>
  );
};

export default Button;
