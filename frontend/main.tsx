import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const MapPage = lazy(() => import("./map/MapPage").then(({ MapPage }) => ({ default: MapPage })));
const page = window.location.pathname === "/map" ? (
  <Suspense fallback={<div className="route-loading">Loading the pint map...</div>}>
    <MapPage />
  </Suspense>
) : (
  <App />
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {page}
  </StrictMode>,
);
