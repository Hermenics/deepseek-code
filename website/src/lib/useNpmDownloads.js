import { useQuery } from "@tanstack/react-query";

const PACKAGE = "@hermenics/deepseek-code";
const DOWNLOADS_URL = `https://api.npmjs.org/downloads/point/last-year/${encodeURIComponent(PACKAGE)}`;

export default function useNpmDownloads() {
  const { data } = useQuery({
    queryKey: ["npm-downloads", PACKAGE],
    queryFn: async () => {
      const response = await fetch(DOWNLOADS_URL);
      if (!response.ok) throw new Error("Unable to fetch npm downloads");
      return response.json();
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return data?.downloads == null
    ? "—"
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(data.downloads);
}
