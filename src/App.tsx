import { Routes, Route, Navigate } from "react-router";
import PanelPage from "./pages/PanelPage";
import AuthPage from "./pages/AuthPage";

export default function App() {
  return (
    <Routes>
        <Route path="/" element={<PanelPage view="home" />} />
        <Route path="/servers" element={<PanelPage view="servers" />} />
        <Route path="/team" element={<PanelPage view="team" />} />
        <Route path="/users" element={<PanelPage view="users" />} />
        <Route path="/account" element={<PanelPage view="account" />} />
        <Route path="/nodes" element={<PanelPage view="nodes" />} />
        <Route path="/locations" element={<PanelPage view="locations" />} />
        <Route path="/apikeys" element={<PanelPage view="apikeys" />} />
        <Route path="/nests" element={<PanelPage view="nests" />} />
        <Route path="/mounts" element={<PanelPage view="mounts" />} />
        <Route path="/settings" element={<PanelPage view="settings" />} />
        <Route path="/settings/:tab" element={<PanelPage view="settings" />} />
        <Route path="/admin" element={<Navigate to="/settings" replace />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot" element={<AuthPage mode="forgot" />} />
        <Route path="/reset" element={<AuthPage mode="reset" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
}
