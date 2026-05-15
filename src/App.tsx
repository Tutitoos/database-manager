import { Navigate, Route, Routes } from "react-router";
import AppLayout from "./pages/AppLayout";
import ConnectionsPage from "./pages/ConnectionsPage";
import SqlLayout from "./pages/sql/SqlLayout";
import SqlPage from "./pages/sql/SqlPage";
import DocumentLayout from "./pages/document/DocumentLayout";
import DocumentPage from "./pages/document/DocumentPage";
import RedisLayout from "./pages/redis/RedisLayout";
import RedisPage from "./pages/redis/RedisPage";
import SettingsLayout from "./pages/settings/SettingsLayout";
import SettingsPage from "./pages/settings/SettingsPage";
import GeneralPage from "./pages/settings/GeneralPage";
import PluginsPage from "./pages/settings/PluginsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/connections" replace />} />
      <Route element={<AppLayout />}>
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="connections/sql" element={<SqlLayout />}>
          <Route index element={<SqlPage />} />
        </Route>
        <Route path="connections/document" element={<DocumentLayout />}>
          <Route index element={<DocumentPage />} />
        </Route>
        <Route path="connections/redis" element={<RedisLayout />}>
          <Route index element={<RedisPage />} />
        </Route>
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<SettingsPage />} />
          <Route path="general" element={<GeneralPage />} />
          <Route path="plugins" element={<PluginsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
