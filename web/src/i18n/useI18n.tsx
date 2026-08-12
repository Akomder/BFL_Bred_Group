import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { dictionary, type Lang, type TextKey } from './dictionary'

interface I18nValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: TextKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const STORAGE_KEY = 'bfl.lang'

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(STORAGE_KEY) as Lang | null) ?? 'en',
  )

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next
    setLangState(next)
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key: TextKey) => dictionary[lang][key] }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = (): I18nValue => {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
