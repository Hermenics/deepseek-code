# Settings Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

The settings module provides `loadMergedSettings()` which returns a fully merged `DeepSeekSettings` object.

## Structure

```
settings/
├── index.ts     — loadMergedSettings(), mergeSettings()
└── types.ts     — DeepSeekSettings, PermissionsConfig, SettingsLevel
```

## Merge Algorithm

```
function mergeSettings(...levels):
  result = {}
  for each level in order:
    for each (key, value) in level:
      if value undefined: skip
      if both arrays: concat + dedup via Set
      if both objects (non-array): deep merge one level
        for each sub-key:
          if both sub-values arrays: concat + dedup
          else: override
      else (scalar): override
  return result
```

## Security Model

```
loadMergedSettings():
  [user, project, local] = await Promise.all([
    loadUserSettings(),      // ~/.deepseek/settings.json — hooks ALLOWED
    loadProjectSettings(),   // .deepseek/settings.json — hooks STRIPPED
    loadLocalSettings()      // .deepseek/settings.local.json — hooks STRIPPED
  ])
  safeProject = stripHooks(project)
  safeLocal = stripHooks(local)
  return mergeSettings(user, safeProject, safeLocal)
```
