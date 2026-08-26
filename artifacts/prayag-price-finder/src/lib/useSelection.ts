import { useCallback, useState, useEffect } from 'react';
import { useSearch } from 'wouter';
import {
  selectedCodesFromParams,
  toggleSelectedCode,
  writeSelectedCodes,
} from "./selectionState";

export function useSelection() {
  const searchString = useSearch();
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCodes(selectedCodesFromParams(params));
  }, [searchString]);

  const toggleCode = useCallback((code: string) => {
    const params = new URLSearchParams(window.location.search);
    const update = toggleSelectedCode(selectedCodesFromParams(params), code);
    if (update.ok) {
      const next = writeSelectedCodes(params, update.codes);
      const newUrl = `${window.location.pathname}${next.toString() ? '?' + next.toString() : ''}`;
      window.history.replaceState(null, "", newUrl);
      window.dispatchEvent(new Event("popstate"));
    }
    return update.ok;
  }, []);

  const clearCodes = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const next = writeSelectedCodes(params, []);
    const newUrl = `${window.location.pathname}${next.toString() ? '?' + next.toString() : ''}`;
    window.history.replaceState(null, "", newUrl);
    window.dispatchEvent(new Event("popstate"));
  }, []);
  
  const removeCode = useCallback((code: string) => {
    const params = new URLSearchParams(window.location.search);
    const update = toggleSelectedCode(selectedCodesFromParams(params), code);
    if (update.ok) {
        const next = writeSelectedCodes(params, update.codes);
        const newUrl = `${window.location.pathname}${next.toString() ? '?' + next.toString() : ''}`;
       window.history.replaceState(null, "", newUrl);
       window.dispatchEvent(new Event("popstate"));
    }
  }, []);

  return { codes, toggleCode, clearCodes, removeCode };
}