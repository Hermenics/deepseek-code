/** Maps internal tool names → display names */
export const TOOL_DISPLAY: Record<string, string> = {
  read_file:        'Read',
  write_file:       'Write',
  patch_file:       'Edit',
  read_folder:      'List',
  shell:            'Bash',
  grep:             'Grep',
  glob:             'Glob',
  web_fetch:        'WebFetch',
  subagent:         'Agent',
  git:              'Git',
  introspect:       'Introspect',
  update_knowledge: 'UpdateKnowledge',
  todo:             'TodoWrite',
}

/** Visual style per tool type */
export const TOOL_STYLE: Record<string, { icon: string; color: string }> = {
  Read:            { icon: '▸', color: '#5599ff' },
  Write:           { icon: '▸', color: '#44cc44' },
  Edit:            { icon: '▸', color: '#44cc44' },
  List:            { icon: '▸', color: '#5599ff' },
  Bash:            { icon: '$', color: '#cc66ff' },
  Grep:            { icon: '⌕', color: '#cccc44' },
  Glob:            { icon: '⌕', color: '#cccc44' },
  WebFetch:        { icon: '↗', color: '#44cccc' },
  Agent:           { icon: '◈', color: '#44cccc' },
  Git:             { icon: '⎇', color: '#ff8844' },
  Introspect:      { icon: '◎', color: '#888888' },
  UpdateKnowledge: { icon: '◎', color: '#888888' },
  TodoWrite:       { icon: '☐', color: '#cccc44' },
}
