import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]';

  const variants = {
    primary:
      'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 shadow-sm hover:shadow-md',
    secondary:
      'border-2 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 focus:ring-primary-500',
    ghost:
      'text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:ring-gray-400',
    danger:
      'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-7 py-3.5 text-base rounded-2xl',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon ? (
        <span className="w-4 h-4">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
