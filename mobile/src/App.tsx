import WebAppWrapper from './WebAppWrapper';
import MockPhone from './components/MockPhone';

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>ÉcoleTrack Mobile</h1>
      </header>

      <MockPhone>
        <WebAppWrapper />
      </MockPhone>
    </div>
  );
}
