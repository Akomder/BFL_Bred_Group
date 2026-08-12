import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { I18nProvider } from './i18n/useI18n.tsx'
import { FormStoreProvider } from './state/formStore.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <FormStoreProvider>
        <App />
      </FormStoreProvider>
    </I18nProvider>
  </StrictMode>,
)
