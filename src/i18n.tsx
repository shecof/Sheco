import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { translate, type Language } from './shared/i18n'
const LanguageContext = createContext({
  language: 'en' as Language,
  setLanguage: (_language: Language) => {},
})
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem('sheco.language') === 'ru' ? 'ru' : 'en',
  )
  useEffect(() => {
    localStorage.setItem('sheco.language', language)
    document.documentElement.lang = language
    void window.sheco.setLanguage(language).catch(() => {})
  }, [language])
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}
export function useI18n() {
  const { language, setLanguage } = useContext(LanguageContext)
  const current = useRef(language)
  current.current = language
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(key, current.current, values),
    [],
  )
  return { language, setLanguage, t }
}
