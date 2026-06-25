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
  primary: 'cyan',
  primaryShimmer: '#5599ff',

  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  suggestion: 'white',
  suggestionShimmer: 'white',

  text: 'white',
  textDim: '#888888',
  textSubtle: '#8a8a8a',
  textInactive: '#6a6a6a',

  userMessageBg: '',
  userMessageBgHover: '',
  thinkingBg: '#111118',
  bashMessageBg: '',
  selectionBg: '',

  promptBorder: '#888888',
  promptBorderShimmer: '#aaaaaa',
  bashBorder: 'magenta',

  diffAdded: 'rgb(34,92,43)',
  diffRemoved: 'rgb(122,41,54)',
  diffAddedWord: 'rgb(56,166,96)',
  diffRemovedWord: 'rgb(179,89,107)',

  modeChat: 'blue',
  modePlan: 'yellow',
  modeAgent: 'green',
  modeAutoAccept: 'red',

  codeBlock: '#c3e88d',
  h1: '#82aaff',
  h2: '#89ddff',
  h3: '#c792ea',
  bullet: '#00cccc',
  rule: '#444444',

  agentRed: 'red',
  agentBlue: 'blue',
  agentGreen: 'green',
  agentYellow: 'yellow',
  agentPurple: 'magenta',
  agentOrange: '#ff8844',
  agentPink: '#ff66aa',
  agentCyan: 'cyan',
}

const lightTheme: ThemeColors = {
  primary: 'blue',
  primaryShimmer: 'cyan',

  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'blue',
  suggestion: 'black',
  suggestionShimmer: 'black',

  text: 'black',
  textDim: '#666666',
  textSubtle: '#888888',
  textInactive: '#aaaaaa',

  userMessageBg: '',
  userMessageBgHover: '',
  thinkingBg: '#f0f0f8',
  bashMessageBg: '',
  selectionBg: '',

  promptBorder: '#888888',
  promptBorderShimmer: '#666666',
  bashBorder: 'magenta',

  diffAdded: 'rgb(200,255,200)',
  diffRemoved: 'rgb(255,200,200)',
  diffAddedWord: 'rgb(0,150,50)',
  diffRemovedWord: 'rgb(200,0,50)',

  modeChat: 'blue',
  modePlan: 'yellow',
  modeAgent: 'green',
  modeAutoAccept: 'red',

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
