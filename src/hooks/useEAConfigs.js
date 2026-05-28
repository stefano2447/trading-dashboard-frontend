import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

export function useEAConfigs() {
  const [configs, setConfigs] = useState({});
  const [loaded, setLoaded]   = useState(false);

  // Carica dal backend al mount
  useEffect(() => {
    api.getEAConfigs().then(data => {
      setConfigs(data);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Salva un campo — aggiorna stato locale e manda al backend
  const updateConfig = useCallback(async (eaName, fields) => {
    // Aggiornamento ottimistico — UI si aggiorna subito
    setConfigs(prev => ({
      ...prev,
      [eaName]: { ...prev[eaName], ...fields },
    }));
    // Salva in background
    try {
      await api.saveEAConfig(eaName, fields);
    } catch (e) {
      console.error("Errore salvataggio config EA:", e);
    }
  }, []);

  const getConfig = useCallback((eaName) => {
    return configs[eaName] || {};
  }, [configs]);

  return { configs, updateConfig, getConfig, loaded };
}