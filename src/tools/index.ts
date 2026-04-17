import { Tool } from './types.js'
import { WriteFile } from './WriteFile.js'
import { ReadFile } from './ReadFile.js'
import { ReadFolder } from './ReadFolder.js'
import { Grep } from './Grep.js'
import { Glob } from './Glob.js'
import { Shell } from './Shell.js'
import { Introspect } from './Introspect.js'
import { WebFetch } from './WebFetch.js'
import { SubAgent } from './SubAgent.js'
import { PatchFile } from './PatchFile.js'
import { UpdateKnowledge } from './UpdateKnowledge.js'
import { Todo } from './Todo.js'
import { Git } from './Git.js'

export const allTools: Tool[] = [WriteFile, PatchFile, ReadFile, ReadFolder, Grep, Glob, Shell, Introspect, WebFetch, SubAgent, UpdateKnowledge, Todo, Git]

export const toolMap = new Map<string, Tool>(allTools.map((t) => [t.name, t]))
