import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AlertsPage } from "./pages/Alerts";
import { QueryPage } from "./pages/Query";
import { StatusPage } from "./pages/Status";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/query" element={<QueryPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
    </Routes>
  </BrowserRouter>,
);
