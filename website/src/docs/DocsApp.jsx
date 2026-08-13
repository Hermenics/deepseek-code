import { Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import "./docs.css";
import Overview from "./pages/Overview";
import Quickstart from "./pages/Quickstart";
import Installation from "./pages/Installation";
import Commands from "./pages/Commands";
import SlashCommands from "./pages/SlashCommands";
import Tools from "./pages/Tools";
import Agents from "./pages/Agents";
import Settings from "./pages/Settings";
import Providers from "./pages/Providers";
import CliReference from "./pages/CliReference";
import Changelog from "./pages/Changelog";
import Hooks from "./pages/Hooks";
import Mcp from "./pages/Mcp";
import Memory from "./pages/Memory";
import SessionsContext from "./pages/SessionsContext";
import InteractionModes from "./pages/InteractionModes";
import Permissions from "./pages/Permissions";
import SubAgents from "./pages/SubAgents";
import Workflows from "./pages/Workflows";
import PluginsSkills from "./pages/PluginsSkills";
import Costs from "./pages/Costs";
import Automation from "./pages/Automation";
import Security from "./pages/Security";
import Troubleshooting from "./pages/Troubleshooting";
import Goals from "./pages/Goals";
import Lsp from "./pages/Lsp";
import Features from "./pages/Features";
import Interface from "./pages/Interface";
import Keybindings from "./pages/Keybindings";
import Themes from "./pages/Themes";
import HowItWorks from "./pages/HowItWorks";
import DeepSeekDirectory from "./pages/DeepSeekDirectory";
import ContextWindow from "./pages/ContextWindow";
import Compaction from "./pages/Compaction";
import Checkpointing from "./pages/Checkpointing";
import Worktrees from "./pages/Worktrees";
import Steering from "./pages/Steering";
import Verification from "./pages/Verification";
import AgentTeams from "./pages/AgentTeams";
import ParallelTasks from "./pages/ParallelTasks";
import AgentMessaging from "./pages/AgentMessaging";
import CodeReview from "./pages/CodeReview";
import MoA from "./pages/MoA";
import KernelPersistence from "./pages/KernelPersistence";
import PluginAuthoring from "./pages/PluginAuthoring";
import SkillAuthoring from "./pages/SkillAuthoring";
import Headless from "./pages/Headless";
import MonitoringAudit from "./pages/MonitoringAudit";
import ModelConfig from "./pages/ModelConfig";
import DebugConfig from "./pages/DebugConfig";
import EnvVars from "./pages/EnvVars";
import Errors from "./pages/Errors";
import Glossary from "./pages/Glossary";
import CommonWorkflows from "./pages/CommonWorkflows";
import BestPractices from "./pages/BestPractices";
import Prompting from "./pages/Prompting";
import PromptLibrary from "./pages/PromptLibrary";
import Upgrade from "./pages/Upgrade";
import Authentication from "./pages/Authentication";
import DeepSeekApi from "./pages/DeepSeekApi";
import Bedrock from "./pages/Bedrock";
import Vertex from "./pages/Vertex";
import LocalModels from "./pages/LocalModels";
import Architecture from "./pages/Architecture";
import Accessibility from "./pages/Accessibility";
import ActivityPanel from "./pages/ActivityPanel";
import BuildPublishing from "./pages/BuildPublishing";
import CatalogGuide from "./pages/CatalogGuide";
import Contributing from "./pages/Contributing";
import Development from "./pages/Development";
import DiffReview from "./pages/DiffReview";
import Doctor from "./pages/Doctor";
import FileOperations from "./pages/FileOperations";
import FileReferences from "./pages/FileReferences";
import GitIntegration from "./pages/GitIntegration";
import InputEditor from "./pages/InputEditor";
import LargeCodebases from "./pages/LargeCodebases";
import MobileAccess from "./pages/MobileAccess";
import PlanModeGuide from "./pages/PlanModeGuide";
import PromptQueue from "./pages/PromptQueue";
import PromptRefinerGuide from "./pages/PromptRefinerGuide";
import RepositoryOnboarding from "./pages/RepositoryOnboarding";
import SearchTools from "./pages/SearchTools";
import SessionExport from "./pages/SessionExport";
import ShellCommands from "./pages/ShellCommands";
import SideQuestions from "./pages/SideQuestions";
import StatusBar from "./pages/StatusBar";
import TerminalSetup from "./pages/TerminalSetup";
import Testing from "./pages/Testing";
import TodoList from "./pages/TodoList";
import WebFetchGuide from "./pages/WebFetchGuide";
import ClipboardPasting from "./pages/ClipboardPasting";
import CommandPalette from "./pages/CommandPalette";
import ExternalPaths from "./pages/ExternalPaths";
import ModelAndEffort from "./pages/ModelAndEffort";
import PermissionsPatterns from "./pages/PermissionsPatterns";
import ReasoningDisplay from "./pages/ReasoningDisplay";
import RetryAndClear from "./pages/RetryAndClear";
import SessionLifecycle from "./pages/SessionLifecycle";
import SystemInspection from "./pages/SystemInspection";
import TaskControl from "./pages/TaskControl";
import TerminalRendering from "./pages/TerminalRendering";
import ToolResults from "./pages/ToolResults";
import UpdateKnowledge from "./pages/UpdateKnowledge";
import VimMode from "./pages/VimMode";
import WorkingDirectory from "./pages/WorkingDirectory";
import SettingsCenter from "./pages/SettingsCenter";
import ExternalEditor from "./pages/ExternalEditor";
import AgentLibraryGuide from "./pages/AgentLibraryGuide";
import HookLifecycle from "./pages/HookLifecycle";
import HookInputOutput from "./pages/HookInputOutput";
import HookTroubleshooting from "./pages/HookTroubleshooting";
import McpConfiguration from "./pages/McpConfiguration";
import McpTransports from "./pages/McpTransports";
import PipeMode from "./pages/PipeMode";
import JsonOutput from "./pages/JsonOutput";
import ExitCodes from "./pages/ExitCodes";
import StreamingBehavior from "./pages/StreamingBehavior";
import CostAccounting from "./pages/CostAccounting";

export default function DocsApp() {
  return (
    <Layout>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="quickstart" element={<Quickstart />} />
        <Route path="installation" element={<Installation />} />
        <Route path="upgrade" element={<Upgrade />} />
        <Route path="best-practices" element={<BestPractices />} />
        <Route path="prompting" element={<Prompting />} />
        <Route path="prompt-library" element={<PromptLibrary />} />
        <Route path="commands" element={<Commands />} />
        <Route path="slash-commands" element={<SlashCommands />} />
        <Route path="tools" element={<Tools />} />
        <Route path="agents" element={<Agents />} />
        <Route path="subagents" element={<SubAgents />} />
        <Route path="memory" element={<Memory />} />
        <Route path="sessions-context" element={<SessionsContext />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="plugins-skills" element={<PluginsSkills />} />
        <Route path="automation" element={<Automation />} />
        <Route path="mcp" element={<Mcp />} />
        <Route path="settings" element={<Settings />} />
        <Route path="providers" element={<Providers />} />
        <Route path="authentication" element={<Authentication />} />
        <Route path="deepseek-api" element={<DeepSeekApi />} />
        <Route path="amazon-bedrock" element={<Bedrock />} />
        <Route path="google-vertex-ai" element={<Vertex />} />
        <Route path="local-models" element={<LocalModels />} />
        <Route path="interaction-modes" element={<InteractionModes />} />
        <Route path="permissions" element={<Permissions />} />
        <Route path="hooks" element={<Hooks />} />
        <Route path="cli-reference" element={<CliReference />} />
        <Route path="costs" element={<Costs />} />
        <Route path="goals" element={<Goals />} />
        <Route path="lsp" element={<Lsp />} />
        <Route path="features" element={<Features />} />
        <Route path="security" element={<Security />} />
        <Route path="troubleshooting" element={<Troubleshooting />} />
        <Route path="interface" element={<Interface />} />
        <Route path="keybindings" element={<Keybindings />} />
        <Route path="themes" element={<Themes />} />
        <Route path="changelog" element={<Changelog />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="architecture" element={<Architecture />} />
        <Route path="deepseek-directory" element={<DeepSeekDirectory />} />
        <Route path="context-window" element={<ContextWindow />} />
        <Route path="compaction" element={<Compaction />} />
        <Route path="checkpointing" element={<Checkpointing />} />
        <Route path="worktrees" element={<Worktrees />} />
        <Route path="steering" element={<Steering />} />
        <Route path="verification" element={<Verification />} />
        <Route path="agent-teams" element={<AgentTeams />} />
        <Route path="parallel-tasks" element={<ParallelTasks />} />
        <Route path="agent-messaging" element={<AgentMessaging />} />
        <Route path="code-review" element={<CodeReview />} />
        <Route path="moa" element={<MoA />} />
        <Route path="kernel-persistence" element={<KernelPersistence />} />
        <Route path="plugin-authoring" element={<PluginAuthoring />} />
        <Route path="skill-authoring" element={<SkillAuthoring />} />
        <Route path="headless" element={<Headless />} />
        <Route path="monitoring-audit" element={<MonitoringAudit />} />
        <Route path="model-config" element={<ModelConfig />} />
        <Route path="debug-config" element={<DebugConfig />} />
        <Route path="env-vars" element={<EnvVars />} />
        <Route path="errors" element={<Errors />} />
        <Route path="glossary" element={<Glossary />} />
        <Route path="common-workflows" element={<CommonWorkflows />} />
        <Route path="repository-onboarding" element={<RepositoryOnboarding />} />
        <Route path="plan-mode" element={<PlanModeGuide />} />
        <Route path="prompt-refiner" element={<PromptRefinerGuide />} />
        <Route path="prompt-queue" element={<PromptQueue />} />
        <Route path="side-questions" element={<SideQuestions />} />
        <Route path="git-integration" element={<GitIntegration />} />
        <Route path="diff-review" element={<DiffReview />} />
        <Route path="large-codebases" element={<LargeCodebases />} />
        <Route path="session-export" element={<SessionExport />} />
        <Route path="file-operations" element={<FileOperations />} />
        <Route path="search" element={<SearchTools />} />
        <Route path="shell" element={<ShellCommands />} />
        <Route path="web-fetch" element={<WebFetchGuide />} />
        <Route path="todos" element={<TodoList />} />
        <Route path="catalog" element={<CatalogGuide />} />
        <Route path="mobile" element={<MobileAccess />} />
        <Route path="terminal-setup" element={<TerminalSetup />} />
        <Route path="input-editor" element={<InputEditor />} />
        <Route path="file-references" element={<FileReferences />} />
        <Route path="accessibility" element={<Accessibility />} />
        <Route path="status-bar" element={<StatusBar />} />
        <Route path="activity-panel" element={<ActivityPanel />} />
        <Route path="doctor" element={<Doctor />} />
        <Route path="development" element={<Development />} />
        <Route path="testing" element={<Testing />} />
        <Route path="build-publishing" element={<BuildPublishing />} />
        <Route path="contributing" element={<Contributing />} />
        <Route path="working-directory" element={<WorkingDirectory />} />
        <Route path="session-lifecycle" element={<SessionLifecycle />} />
        <Route path="retry-and-clear" element={<RetryAndClear />} />
        <Route path="system-inspection" element={<SystemInspection />} />
        <Route path="model-and-effort" element={<ModelAndEffort />} />
        <Route path="vim-mode" element={<VimMode />} />
        <Route path="clipboard-pasting" element={<ClipboardPasting />} />
        <Route path="command-palette" element={<CommandPalette />} />
        <Route path="terminal-rendering" element={<TerminalRendering />} />
        <Route path="reasoning-display" element={<ReasoningDisplay />} />
        <Route path="update-knowledge" element={<UpdateKnowledge />} />
        <Route path="task-control" element={<TaskControl />} />
        <Route path="tool-results" element={<ToolResults />} />
        <Route path="permission-patterns" element={<PermissionsPatterns />} />
        <Route path="external-paths" element={<ExternalPaths />} />
        <Route path="settings-center" element={<SettingsCenter />} />
        <Route path="external-editor" element={<ExternalEditor />} />
        <Route path="agent-library" element={<AgentLibraryGuide />} />
        <Route path="hook-lifecycle" element={<HookLifecycle />} />
        <Route path="hook-input-output" element={<HookInputOutput />} />
        <Route path="hook-troubleshooting" element={<HookTroubleshooting />} />
        <Route path="mcp-configuration" element={<McpConfiguration />} />
        <Route path="mcp-transports" element={<McpTransports />} />
        <Route path="pipe-mode" element={<PipeMode />} />
        <Route path="json-output" element={<JsonOutput />} />
        <Route path="exit-codes" element={<ExitCodes />} />
        <Route path="streaming-behavior" element={<StreamingBehavior />} />
        <Route path="cost-accounting" element={<CostAccounting />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </Layout>
  );
}
