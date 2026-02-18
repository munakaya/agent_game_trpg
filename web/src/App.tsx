import { Outlet, Link } from 'react-router-dom';

export default function App() {
  return (
    <div className="app-shell">
      <nav className="top-nav">
        <Link to="/" className="brand-link">Rise of Agents</Link>
        <div className="top-nav-links">
          <Link to="/" className="top-nav-link">Live</Link>
          <Link to="/archive" className="top-nav-link">Archive</Link>
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
