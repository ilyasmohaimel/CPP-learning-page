import { useEffect, useState } from "react";
import type { Preferences } from "../../shared/app";

type Theme = Preferences["theme"];
const storageKey = "c-forge-theme:v1:" + (import.meta.env?.BASE_URL ?? "/");
function rememberedTheme(): Theme {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    /* Account preferences still work when browser storage is blocked. */
  }
  return "light";
}

/** The authenticated preference wins; the non-sensitive mirror prevents a reload flash. */
export function useTheme(preference: Theme | undefined) {
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const selected = preference ?? rememberedTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        selected === "system" ? (media.matches ? "dark" : "light") : selected;
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#1c1d22" : "#f5f4ef");
      setResolved(theme);
    };
    apply();
    if (preference) {
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        /* Server-saved choice remains authoritative. */
      }
    }
    if (selected === "system") media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  return resolved;
}
