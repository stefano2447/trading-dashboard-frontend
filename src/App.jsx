import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout }       from "./components/layout/Layout";
import { EAOverview }   from "./pages/EAOverview";
import { EADetail }     from "./pages/EADetail";
import { Correlations } from "./pages/Correlations";
import { Portfolios }   from "./pages/Portfolios";
import { LiveAccounts } from "./pages/LiveAccounts";
import { News }         from "./pages/News";
import { PropFirmRules } from "./pages/PropFirmRules";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/"              element={<EAOverview />}   />
          <Route path="/analisi"       element={<EADetail />}     />
          <Route path="/analisi/:name" element={<EADetail />}     />
          <Route path="/correlazioni"  element={<Correlations />} />
          <Route path="/portafogli"    element={<Portfolios />}   />
          <Route path="/conti"         element={<LiveAccounts />} />
          <Route path="/news"          element={<News />}         />
          <Route path="/propfirm" element={<PropFirmRules />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}