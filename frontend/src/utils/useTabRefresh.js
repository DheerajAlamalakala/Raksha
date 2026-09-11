import { useEffect, useRef, useState } from "react";

export function useTabRefresh(load) {
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadRef.current();
      setLastSync(new Date());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("raksha:refresh", handler);
    return () => window.removeEventListener("raksha:refresh", handler);
  }, []);

  return { refresh, refreshing, lastSync };
}
