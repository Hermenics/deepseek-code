import { Tool } from './types.js'
import { WriteFile } from './WriteFile/WriteFile.js'
import { ReadFile } from './ReadFile/ReadFile.js'
import { ReadFolder } from './ReadFolder/ReadFolder.js'
import { Grep } from './Grep/Grep.js'
import { Glob } from './Glob/Glob.js'
import { Shell } from './Shell/Shell.js'
import { Introspect } from './Introspect/Introspect.js'
import { WebFetch } from './WebFetch/WebFetch.js'
import { SubAgent } from './SubAgent/SubAgent.js'
import { PatchFile } from './PatchFile/PatchFile.js'
import { UpdateKnowledge } from './UpdateKnowledge/UpdateKnowledge.js'
import { Todo } from './Todo/Todo.js'
import { Git } from './Git/Git.js'
import { MemoryTool } from './Memory/MemoryTool.js'
import { MoATool } from './MoA/MoA.js'
import { EditFile } from './EditFile/EditFile.js'

export const allTools: Tool[] = [WriteFile, EditFile, PatchFile, ReadFile, ReadFolder, Grep, Glob, Shell, Introspect, WebFetch, SubAgent, UpdateKnowledge, Todo, Git, MemoryTool, MoATool]

export const toolMap = new Map<string, Tool>(allTools.map((t) => [t.name, t]))
