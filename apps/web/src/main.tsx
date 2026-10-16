import { createRoot } from "react-dom/client";
import App from "./App";
import PublishedApp from "./PublishedApp";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  import.meta.env.VITE_STAGE === "playtest" ? <PublishedApp /> : <App />,
);
