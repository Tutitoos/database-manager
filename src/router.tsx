import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import AppLayout from "./pages/AppLayout";
import ConnectionsPage from "./pages/ConnectionsPage";
import LoginPage from "./pages/LoginPage";
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
import AccountPage from "./pages/settings/AccountPage";
import CredentialsPage from "./pages/settings/CredentialsPage";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/connections" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

const connectionsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/connections",
  component: ConnectionsPage,
});

const sqlLayoutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/connections/sql",
  component: SqlLayout,
});
const sqlIndexRoute = createRoute({
  getParentRoute: () => sqlLayoutRoute,
  path: "/",
  component: SqlPage,
});

const documentLayoutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/connections/document",
  component: DocumentLayout,
});
const documentIndexRoute = createRoute({
  getParentRoute: () => documentLayoutRoute,
  path: "/",
  component: DocumentPage,
});

const redisLayoutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/connections/redis",
  component: RedisLayout,
});
const redisIndexRoute = createRoute({
  getParentRoute: () => redisLayoutRoute,
  path: "/",
  component: RedisPage,
});

const settingsLayoutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/settings",
  component: SettingsLayout,
});
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: "/",
  component: SettingsPage,
});
const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: "general",
  component: GeneralPage,
});
const settingsAccountRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: "account",
  component: AccountPage,
});
const settingsCredentialsRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: "credentials",
  component: CredentialsPage,
});
const settingsPluginsRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: "plugins",
  component: PluginsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  layoutRoute.addChildren([
    connectionsRoute,
    sqlLayoutRoute.addChildren([sqlIndexRoute]),
    documentLayoutRoute.addChildren([documentIndexRoute]),
    redisLayoutRoute.addChildren([redisIndexRoute]),
    settingsLayoutRoute.addChildren([
      settingsIndexRoute,
      settingsGeneralRoute,
      settingsAccountRoute,
      settingsCredentialsRoute,
      settingsPluginsRoute,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
