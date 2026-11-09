import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import HealthStatus from "./components/HealthStatus";
import Preferences from "./pages/Preferences";
import Prepare from "./pages/Prepare";
import Results from "./pages/Results";
import { SessionProvider } from "./state";

export default function App() {
  return (
    <SessionProvider>
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <header style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>TimetableSolver</h1>
        <nav style={{ display: "flex", gap: 12 }}>
          <NavLink to="/prepare">준비</NavLink>
          <NavLink to="/preferences">선호</NavLink>
          <NavLink to="/results">결과</NavLink>
        </nav>
        <HealthStatus />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/prepare" replace />} />
          <Route path="/prepare" element={<Prepare />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="/results" element={<Results />} />
        </Routes>
      </main>
    </div>
    </SessionProvider>
  );
}
