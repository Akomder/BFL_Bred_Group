import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  block?: boolean
}

const VARIANTS: Record<string, string> = {
  primary:
    'bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 disabled:text-brand-300',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-100 disabled:text-brand-300',
  danger: 'bg-white text-danger border border-danger/30 hover:bg-danger/5',
}

export const Button = ({ variant = 'primary', block, className = '', ...rest }: ButtonProps) => (
  <button
    {...rest}
    className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold
      transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
  />
)

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section
    className={`rounded-[18px] border border-line bg-white p-5 shadow-[0_1px_2px_rgba(15,42,61,0.05)] sm:p-6 ${className}`}
  >
    {children}
  </section>
)

export const FieldLabel = ({
  children,
  htmlFor,
  required,
}: {
  children: ReactNode
  htmlFor?: string
  required?: boolean
}) => (
  <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-ink">
    {children}
    {required && <span className="ml-1 text-danger">*</span>}
  </label>
)

export const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? (
    <p role="alert" className="mt-2 text-sm font-medium text-danger">
      {children}
    </p>
  ) : null

/** Shared look for every text input, textarea and select on the form. */
export const inputClass = (invalid?: boolean) =>
  `w-full rounded-xl border bg-white px-4 py-3 text-ink outline-none transition-colors
   placeholder:text-muted/60 focus:border-brand-500 focus:ring-4 focus:ring-brand-100
   ${invalid ? 'border-danger' : 'border-line'}`

/** Selects are filled light blue, as specified for the currency controls. */
export const selectClass = (invalid?: boolean) =>
  `w-full appearance-none rounded-xl border bg-brand-100 px-4 py-3 font-semibold text-brand-800
   outline-none transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-100
   ${invalid ? 'border-danger' : 'border-brand-200'}`

export const Chevron = () => (
  <svg
    aria-hidden
    viewBox="0 0 20 20"
    className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-700"
  >
    <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
