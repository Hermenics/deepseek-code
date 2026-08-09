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

export default function DocsApp() {
  return (
    <Layout>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="quickstart" element={<Quickstart />} />
        <Route path="installation" element={<Installation />} />
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
        <Route path="*" element={<Overview />} />
      </Routes>
    </Layout>
  );
}
