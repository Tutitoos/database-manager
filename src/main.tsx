import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { VaultGate } from "./components/VaultGate";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VaultGate>
      <RouterProvider router={router} />
    </VaultGate>
  </StrictMode>,
);
