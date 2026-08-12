import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import { emptyForm, type FormData, type TxKind } from '../lib/types'

export type Step = 'start' | 'form' | 'photo' | 'signature' | 'review' | 'done' | 'settings'

/**
 * `returnTo` is what makes the Edit buttons on the review screen behave: a step
 * entered from review carries 'review' here, and its primary action jumps
 * straight back instead of advancing to the next step in the sequence.
 */
interface State {
  step: Step
  returnTo: Step | null
  data: FormData
}

type Action =
  | { type: 'start'; kind: TxKind }
  | { type: 'goto'; step: Step; returnTo?: Step | null }
  | { type: 'patch'; patch: Partial<FormData> }
  | { type: 'reset' }

const FORWARD: Record<string, Step> = {
  form: 'photo',
  photo: 'signature',
  signature: 'review',
}

const initialState: State = { step: 'start', returnTo: null, data: emptyForm('deposit') }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'start':
      return { step: 'form', returnTo: null, data: emptyForm(action.kind) }
    case 'goto':
      return {
        ...state,
        step: action.step,
        returnTo: action.returnTo === undefined ? state.returnTo : action.returnTo,
      }
    case 'patch':
      return { ...state, data: { ...state.data, ...action.patch } }
    case 'reset':
      return initialState
  }
}

interface StoreValue extends State {
  begin: (kind: TxKind) => void
  goto: (step: Step, returnTo?: Step | null) => void
  patch: (patch: Partial<FormData>) => void
  /** Advance to the next step, or back to review when editing. */
  advance: () => void
  editFrom: (step: Step) => void
  reset: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export const FormStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState)

  const goto = useCallback(
    (step: Step, returnTo?: Step | null) => dispatch({ type: 'goto', step, returnTo }),
    [],
  )

  const advance = useCallback(() => {
    if (state.returnTo === 'review') {
      dispatch({ type: 'goto', step: 'review', returnTo: null })
      return
    }
    const next = FORWARD[state.step]
    if (next) dispatch({ type: 'goto', step: next, returnTo: null })
  }, [state.step, state.returnTo])

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      begin: (kind) => dispatch({ type: 'start', kind }),
      goto,
      patch: (patch) => dispatch({ type: 'patch', patch }),
      advance,
      editFrom: (step) => dispatch({ type: 'goto', step, returnTo: 'review' }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [state, goto, advance],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useFormStore = (): StoreValue => {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useFormStore must be used inside <FormStoreProvider>')
  return ctx
}
