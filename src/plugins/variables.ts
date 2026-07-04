export function resolvePluginVariables(str: string, pluginRoot: string): string {
  return str.replaceAll('${PLUGIN_ROOT}', pluginRoot)
}
