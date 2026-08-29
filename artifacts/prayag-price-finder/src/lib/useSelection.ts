import { useCallback, useState, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import {
  selectedCodesFromParams,
  toggleSelectedCode,
} from "./selectionState";
import {
  localPriceFinderUrl,
  updateSelectedCodes,
} from "./priceFinderRouteState";

export function useSelection() {
  const searchString = useSearch();
  const [location, navigate] = useLocation();
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCodes(selectedCodesFromParams(params));
  }, [searchString]);

  const toggleCode = useCallback((code: string) => {
    const params = new URLSearchParams(window.location.search);
    const update = toggleSelectedCode(selectedCodesFromParams(params), code);
    if (update.ok) {
      const next = updateSelectedCodes(params, update.codes);
      navigate(localPriceFinderUrl(location as "/" | "/comparison", next));
    }
    return update.ok;
  }, [location, navigate]);

  const clearCodes = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const next = updateSelectedCodes(params, []);
    navigate(localPriceFinderUrl(location as "/" | "/comparison", next));
  }, [location, navigate]);
  
  const removeCode = useCallback((code: string) => {
    const params = new URLSearchParams(window.location.search);
    const update = toggleSelectedCode(selectedCodesFromParams(params), code);
    if (update.ok) {
      const next = updateSelectedCodes(params, update.codes);
      navigate(localPriceFinderUrl(location as "/" | "/comparison", next));
    }
  }, [location, navigate]);

  return { codes, toggleCode, clearCodes, removeCode };
}