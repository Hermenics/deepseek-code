import { useQuery } from "@tanstack/react-query";

const PACKAGE_URL = "https://registry.npmjs.org/@hermenics%2Fdeepseek-code/latest";
const FALLBACK_VERSION = "0.3.9";

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
