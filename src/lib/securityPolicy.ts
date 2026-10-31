// Hash of the inline preamble emitted by the current @vitejs/plugin-react version.
const REACT_REFRESH_PREAMBLE_HASH = 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=';

export function buildContentSecurityPolicy(isDevelopment: boolean): string {
  const scriptSource = isDevelopment
    ? `script-src 'self' '${REACT_REFRESH_PREAMBLE_HASH}'`
    : "script-src 'self'";
  const connectSources = [
    "'self'",
    'https://*.firebaseapp.com',
    'https://*.firebasestorage.app',
    'https://*.firebaseio.com',
    'https://*.googleapis.com',
    'https://*.googleusercontent.com',
    ...(isDevelopment ? ['ws://localhost:24678'] : []),
  ];

  return [
    "default-src 'self'",
    scriptSource,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://flagcdn.com https://*.flagcdn.com",
    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
    `connect-src ${connectSources.join(' ')}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
