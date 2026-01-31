import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { deleteAllTaxAccounts } from './actions/persons'

// Expose cleanup function globally for debugging
// Run in console: window.deleteAllTaxAccounts().then(console.log)
(window as unknown as { deleteAllTaxAccounts: typeof deleteAllTaxAccounts }).deleteAllTaxAccounts = deleteAllTaxAccounts;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
