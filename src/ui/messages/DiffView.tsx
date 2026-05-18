import { useMemo } from 'react'
import { SyntaxStyle, RGBA } from '@opentui/core'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { DIFF_MAX_LINES } from '../../constants.js'

interface DiffLine { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

interface Props {
  path: string
  added: number
  removed: number
  firstChanged: number
  lines: DiffLine[]
  theme: ThemeName
}

const THEME_COLORS: Record<ThemeName, { addedBg: string; removedBg: string; addedSign: string; removedSign: string }> = {
  'dark':             { addedBg: 'rgb(34,92,43)',    removedBg: 'rgb(122,41,54)',   addedSign: 'rgb(56,166,96)',  removedSign: 'rgb(179,89,107)' },
  'light':            { addedBg: 'rgb(105,219,124)', removedBg: 'rgb(255,168,180)', addedSign: 'rgb(47,157,68)',  removedSign: 'rgb(209,69,75)'  },
  'dark-daltonized':  { addedBg: 'rgb(0,68,102)',    removedBg: 'rgb(102,0,0)',     addedSign: 'rgb(0,119,179)', removedSign: 'rgb(179,0,0)'    },
  'light-daltonized': { addedBg: 'rgb(153,204,255)', removedBg: 'rgb(255,204,204)', addedSign: 'rgb(51,102,204)',removedSign: 'rgb(153,51,51)'  },
  'dark-ansi':        { addedBg: '#004400',          removedBg: '#440000',          addedSign: '#00ff00',        removedSign: '#ff0000'         },
  'light-ansi':       { addedBg: '#004400',          removedBg: '#440000',          addedSign: '#00ff00',        removedSign: '#ff0000'         },
}

export function DiffView({ path, added, removed, firstChanged, lines, theme }: Props) {
  const c = THEME_COLORS[theme]
  const filename = path.split('/').pop() ?? path

  const diffText = useMemo(() => {
    const visible = lines.slice(0, DIFF_MAX_LINES)
    // l.text already contains the prefix (+/-/ ) from computeDiff
    return visible.map((l) => l.text).join('\n')
  }, [lines])

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text fg="green">{'●'}</text>
        <text>{'Write '}</text>
        <text fg="cyan">{path}</text>
      </box>
      <box marginLeft={2}>
        <text fg={c.addedSign}>{'✓ ' + added + (added === 1 ? ' line' : ' lines')}</text>
        <text fg="#888888">{'  '}</text>
        <text fg={c.removedSign}>{'✘ ' + removed + (removed === 1 ? ' line' : ' lines')}</text>
        <text fg="#888888">{' at L' + firstChanged + ' in ' + filename}</text>
      </box>
      <box flexDirection="column" marginLeft={2} marginTop={1}>
        <diff
          diff={diffText}
          view="unified"
          showLineNumbers
          addedBg={c.addedBg}
          removedBg={c.removedBg}
          addedSignColor={c.addedSign}
          removedSignColor={c.removedSign}
          syntaxStyle={SyntaxStyle.fromStyles({
            default: { fg: RGBA.fromHex('#a6accd') },
          })}
        />
      </box>
    </box>
  )
}
