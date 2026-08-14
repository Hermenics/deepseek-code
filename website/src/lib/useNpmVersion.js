import { useQuery } from "@tanstack/react-query";
import RELEASES from "../docs/data/releases.json";

const PACKAGE_URL = "https://registry.npmjs.org/@hermenics%2Fdeepseek-code/latest";
const FALLBACK_VERSION = RELEASES[0]?.version || "0.0.0";

export default function useNpmVersion() {
  const { data } = useQuery({
    queryKey: ["npm-version", "@hermenics/deepseek-code"],
    queryFn: async () => {
      const response = await fetch(PACKAGE_URL);
      if (!response.ok) throw new Error("Unable to fetch npm version");
      const packageInfo = await response.json();
      return packageInfo.version;
    },
    staleTime: 0,
    retry: 1,
  });

  return `v${data || FALLBACK_VERSION}`;
}
