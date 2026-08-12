import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ACCOUNT_MASK, digitsOnly, splitAccountNumber } from '../lib/format'

/**
 * The account number is typed into five separate boxes matching the printed
 * form's 3-7-2-4-2 grouping. Focus moves forward when a block fills and back
 * when Backspace empties one, so it types like a single field.
 *
 * No placeholder or helper text: the blocks themselves show the expected shape.
 */
export const AccountNumberInput = ({
  value,
  onChange,
  invalid,
  id,
}: {
  value: string
  onChange: (digits: string) => void
  invalid?: boolean
  id?: string
}) => {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const blocks = splitAccountNumber(value)

  const commit = (next: string[]) => onChange(next.join(''))

  const handleChange = (index: number, raw: string) => {
    const typed = digitsOnly(raw)
    const next = [...blocks]
    const size = ACCOUNT_MASK[index]
    next[index] = typed.slice(0, size)

    // Anything typed or pasted beyond this block spills into the following ones.
    let overflow = typed.slice(size)
    for (let i = index + 1; i < ACCOUNT_MASK.length && overflow.length > 0; i += 1) {
      next[i] = overflow.slice(0, ACCOUNT_MASK[i])
      overflow = overflow.slice(ACCOUNT_MASK[i])
    }
    commit(next)

    if (next[index].length === size && index < ACCOUNT_MASK.length - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && blocks[index] === '' && index > 0) {
      e.preventDefault()
      const next = [...blocks]
      next[index - 1] = next[index - 1].slice(0, -1)
      commit(next)
      refs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < ACCOUNT_MASK.length - 1) refs.current[index + 1]?.focus()
  }

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    handleChange(index, digitsOnly(e.clipboardData.getData('text')))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACCOUNT_MASK.map((size, index) => (
        <input
          key={index}
          id={index === 0 ? id : undefined}
          ref={(el) => {
            refs.current[index] = el
          }}
          value={blocks[index]}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePaste(index, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Account number block ${index + 1} of ${ACCOUNT_MASK.length}`}
          // Blocks shrink with the viewport so all five stay on one line on a
          // phone, and sit at a comfortable tablet size from ~430px up.
          style={{ width: `calc(${size} * clamp(0.6rem, 2.4vw, 1.15rem) + 1.1rem)` }}
          className={`min-w-0 rounded-xl border bg-white px-1 py-3 text-center font-mono text-base tracking-[0.08em]
            text-ink outline-none transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-100
            sm:px-2 sm:text-lg sm:tracking-[0.12em]
            ${invalid ? 'border-danger' : 'border-line'}`}
        />
      ))}
    </div>
  )
}
