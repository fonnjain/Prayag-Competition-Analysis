import { createContext, useContext, useEffect } from "react";

/** Pages with permission-dependent titles supply the same title to mobile chrome. */
export const MobilePageTitleContext = createContext<(title: string | null) => void>(() => {});

export function useMobilePageTitle(title: string) {
  const setTitle = useContext(MobilePageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
