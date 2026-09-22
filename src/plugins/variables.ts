/** Expands `${PLUGIN_ROOT}` placeholders in plugin config strings to the plugin's install path. */
export function resolvePluginVariables(str: string, pluginRoot: string): string {
  return str.replaceAll('${PLUGIN_ROOT}', pluginRoot)
}
