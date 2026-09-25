import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import PrivacyPolicyPage from './components/PrivacyPolicyPage.tsx';
import './index.css';

const isPrivacyPolicyPath = window.location.pathname === '/politique-confidentialite';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPrivacyPolicyPath ? (
      <PrivacyPolicyPage />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
);
