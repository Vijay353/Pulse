import { createContext, useContext } from "react";
import { Analytics, noAnalytics } from "./clarity";

export const AnalyticsContext = createContext<Analytics>(noAnalytics);
export const useAnalytics = () => useContext(AnalyticsContext);
