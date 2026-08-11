import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className = '', ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className={className}>
        {label && (
          <label htmlFor={inputId} className="form-label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={error ? 'form-input-error' : 'form-input'}
          {...props}
        />
        {error && <p className="form-error">{error}</p>}
        {hint && !error && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
