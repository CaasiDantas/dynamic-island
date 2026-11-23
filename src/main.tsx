// Primeiro: o modo demonstração precisa preparar os dados antes das stores carregarem.
import "./demo/seed";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/island.css";
import "./styles/views.css";
import "./styles/pomodoro.css";
import "./styles/notch.css";
import "./styles/claude.css";
import "./styles/todo.css";
import "./styles/pills.css";
import "./styles/palette.css";
import "./styles/monitor.css";
import "./styles/perf.css";
import { perf } from "./perf/monitor";
import { installPerfRemote } from "./perf/remote";
import "./demo/controls";
import { startUpdateChecks } from "./features/update/store";

installPerfRemote();
startUpdateChecks();
// Ctrl+Shift+D liga/desliga o diagnóstico (com a janela em foco).
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "KeyD") perf.setEnabled(!perf.enabled);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
