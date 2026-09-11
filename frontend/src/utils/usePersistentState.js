import { useEffect, useState } from "react";

export function usePersistentState(key, initialValue) {
  const [value,setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(`raksha:${key}`);
      return saved == null ? initialValue : JSON.parse(saved);
    } catch { return initialValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(`raksha:${key}`, JSON.stringify(value)); } catch {}
  }, [key,value]);
  return [value,setValue];
}
