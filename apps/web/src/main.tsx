import { createRoot } from "react-dom/client";
import App from "./App";
import PublishedApp from "./PublishedApp";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  ["playtest", "daily-preview", "daily"].includes(
    import.meta.env.VITE_STAGE,
  ) ? (
    <PublishedApp />
  ) : (
    <App />
  ),
);
