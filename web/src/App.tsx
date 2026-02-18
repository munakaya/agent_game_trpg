import { Outlet, NavLink } from 'react-router-dom';

export default function App() {
  return (
    <div className="app-shell">
      <nav className="top-nav">
        <NavLink to="/" className="brand-link">
          <span className="brand-main">Rise of Agents</span>
          <span className="brand-sub">Tactical Command</span>
        </NavLink>
        <div className="top-nav-links">
          <NavLink to="/" end className={({ isActive }) => `top-nav-link${isActive ? ' active' : ''}`}>
            Live Ops
          </NavLink>
          <NavLink to="/archive" className={({ isActive }) => `top-nav-link${isActive ? ' active' : ''}`}>
            Archive
          </NavLink>
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
