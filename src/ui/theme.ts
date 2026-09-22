// Design System centralizado do DeepSeek Code
// Baseado na arquitetura do Claude Code, adaptado com identidade visual DeepSeek (azul)

export type ThemeName = 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'dark-ansi' | 'light-ansi'

export interface ThemeColors {
  // Brand
  primary: string
  primaryShimmer: string

  // Semantic
  success: string
  error: string
  warning: string
  info: string
  suggestion: string
  suggestionShimmer: string

  // Text
  text: string
  textDim: string
  textSubtle: string
  textInactive: string

  // Backgrounds
  userMessageBg: string
  userMessageBgHover: string
  thinkingBg: string
  bashMessageBg: string
  selectionBg: string
  inputCursorBg: string
  inputCursorText: string

  // Borders
  promptBorder: string
  promptBorderShimmer: string
  bashBorder: string

  // Diff
  diffAdded: string
  diffRemoved: string
  diffAddedWord: string
  diffRemovedWord: string

  // Mode colors
  modeChat: string
  modePlan: string
  modeAgent: string
  modeAutoAccept: string

  // Markdown
  codeBlock: string
  h1: string
  h2: string
  h3: string
  bullet: string
  rule: string

  // Agent colors
  agentRed: string
  agentBlue: string
  agentGreen: string
  agentYellow: string
  agentPurple: string
  agentOrange: string
  agentPink: string
  agentCyan: string
}

const darkTheme: ThemeColors = {
  primary: '#78a9ff',
  primaryShimmer: '#b7d1ff',

  success: '#7bd88f',
  error: '#ff7b8a',
  warning: '#f4ca73',
  info: '#7dd3fc',
  suggestion: '#f3f6fb',
  suggestionShimmer: '#ffffff',

  text: '#f3f6fb',
  textDim: '#93a1b5',
  textSubtle: '#718096',
  textInactive: '#4c5b70',

  userMessageBg: '',
  userMessageBgHover: '',
  thinkingBg: '#111b2d',
  bashMessageBg: '',
  selectionBg: '#243653',
  inputCursorBg: '#9dc2ff',
  inputCursorText: '#152238',

  promptBorder: '#456a9f',
  promptBorderShimmer: '#78a9ff',
  bashBorder: '#d084ff',

  diffAdded: 'rgb(34,92,43)',
  diffRemoved: 'rgb(122,41,54)',
  diffAddedWord: 'rgb(56,166,96)',
  diffRemovedWord: 'rgb(179,89,107)',

  modeChat: '#78a9ff',
  modePlan: '#f4ca73',
  modeAgent: '#7bd88f',
  modeAutoAccept: '#ff7b8a',

  codeBlock: '#b5e48c',
  h1: '#a7c7ff',
  h2: '#7dd3fc',
  h3: '#d0a6ff',
  bullet: '#6ee7d8',
  rule: '#2e405c',

  agentRed: '#ff7b8a',
  agentBlue: '#78a9ff',
  agentGreen: '#7bd88f',
  agentYellow: '#f4ca73',
  agentPurple: '#c69bff',
  agentOrange: '#ffab70',
  agentPink: '#ff91c8',
  agentCyan: '#68d8e8',
}

const lightTheme: ThemeColors = {
  primary: '#245fba',
  primaryShimmer: '#3b82d0',

  success: '#16733a',
  error: '#c43d50',
  warning: '#9a6500',
  info: '#087ea4',
  suggestion: '#172033',
  suggestionShimmer: '#000000',

  text: '#172033',
  textDim: '#586579',
  textSubtle: '#738095',
  textInactive: '#a3afbf',

  userMessageBg: '',
  userMessageBgHover: '',
  thinkingBg: '#edf3fb',
  bashMessageBg: '',
  selectionBg: '#dbeafe',
  inputCursorBg: '#245fba',
  inputCursorText: '#ffffff',

  promptBorder: '#6b86ab',
  promptBorderShimmer: '#245fba',
  bashBorder: '#9444b8',

  diffAdded: 'rgb(200,255,200)',
  diffRemoved: 'rgb(255,200,200)',
  diffAddedWord: 'rgb(0,150,50)',
  diffRemovedWord: 'rgb(200,0,50)',

  modeChat: '#245fba',
  modePlan: '#9a6500',
  modeAgent: '#16733a',
  modeAutoAccept: '#c43d50',

  codeBlock: '#2e7d32',
  h1: '#1565c0',
  h2: '#00838f',
  h3: '#6a1b9a',
  bullet: '#1976d2',
  rule: '#cccccc',

  agentRed: 'red',
  agentBlue: 'blue',
  agentGreen: 'green',
  agentYellow: 'yellow',
  agentPurple: 'magenta',
  agentOrange: '#cc6600',
  agentPink: '#cc3366',
  agentCyan: 'cyan',
}

const darkDaltonizedTheme: ThemeColors = {
  ...darkTheme,
  success: 'rgb(0,176,240)',
  error: 'rgb(255,150,0)',
  warning: 'rgb(255,255,0)',
  diffAdded: 'rgb(0,60,120)',
  diffRemoved: 'rgb(120,60,0)',
  diffAddedWord: 'rgb(0,150,255)',
  diffRemovedWord: 'rgb(255,150,0)',
}

const lightDaltonizedTheme: ThemeColors = {
  ...lightTheme,
  success: 'rgb(0,120,200)',
  error: 'rgb(200,100,0)',
  warning: 'rgb(180,180,0)',
  diffAdded: 'rgb(200,230,255)',
  diffRemoved: 'rgb(255,230,200)',
  diffAddedWord: 'rgb(0,100,200)',
  diffRemovedWord: 'rgb(200,100,0)',
}

const darkAnsiTheme: ThemeColors = {
  ...darkTheme,
  primary: 'blue',
  primaryShimmer: 'cyan',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'blue',
  suggestion: 'cyan',
  suggestionShimmer: 'cyan',
  text: 'white',
  textDim: 'gray',
  textSubtle: 'gray',
  textInactive: 'gray',
  userMessageBg: '',
  userMessageBgHover: '',
  thinkingBg: '',
  bashMessageBg: '',
  selectionBg: '',
  inputCursorBg: 'blue',
  inputCursorText: 'white',
  promptBorder: 'gray',
  promptBorderShimmer: 'white',
  bashBorder: 'magenta',
  diffAdded: 'green',
  diffRemoved: 'red',
  diffAddedWord: 'green',
  diffRemovedWord: 'red',
  codeBlock: 'green',
  h1: 'blue',
  h2: 'cyan',
  h3: 'magenta',
  bullet: 'blue',
  rule: 'gray',
}

const lightAnsiTheme: ThemeColors = {
  ...darkAnsiTheme,
  text: 'black',
  textDim: 'gray',
}

const THEMES: Record<ThemeName, ThemeColors> = {
  'dark': darkTheme,
  'light': lightTheme,
  'dark-daltonized': darkDaltonizedTheme,
  'light-daltonized': lightDaltonizedTheme,
  'dark-ansi': darkAnsiTheme,
  'light-ansi': lightAnsiTheme,
}

/** Returns the color palette for a theme, falling back to the dark palette for unknown names. */
export function getThemeColors(theme: ThemeName): ThemeColors {
  return THEMES[theme] ?? darkTheme
}

export function isDarkTheme(theme: ThemeName): boolean {
  return theme.startsWith('dark')
}

export const STATUS_ICONS = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',
  loading: '…',
  thinking: '◌',
  assistant: '●',
  user: '❯',
  bash: '$',
  terminal: '$',
  agent: '◈',
  subagent: '⎿',
} as const

export const DIVIDER_CHAR = '─'

export const PROGRESS_CHARS = ['█', '▉', '▊', '▋', '▌', '▍', '▎', '▏', ' '] as const

export const WELCOME_WIDTH = 58
