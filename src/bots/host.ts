import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { loadSavedConfig } from '../ui/setup/ApiKeySetup.js'

const BOOTSTRAP = String.raw`set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo 'Connect with a regular SSH user, not root.' >&2
  exit 1
fi
if [ ! -r /etc/os-release ]; then
  echo 'This installer supports Debian and Ubuntu hosts.' >&2
  exit 1
fi
. /etc/os-release
case "$ID" in debian|ubuntu) ;; *) echo 'This installer supports Debian and Ubuntu hosts.' >&2; exit 1 ;; esac

export PATH="$HOME/.local/bin:$HOME/.bun/bin:/snap/bin:$PATH"
node_ok=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [ "$node_major" -ge 18 ]; then node_ok=1; fi
fi
browser_ok=0
for bin in google-chrome-stable google-chrome chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$bin" >/dev/null 2>&1; then browser_ok=1; break; fi
done
curl_ok=0
command -v curl >/dev/null 2>&1 && curl_ok=1
unzip_ok=0
command -v unzip >/dev/null 2>&1 && unzip_ok=1

if [ "$node_ok" -eq 0 ] || [ "$browser_ok" -eq 0 ] || [ "$curl_ok" -eq 0 ] || [ "$unzip_ok" -eq 0 ]; then
  if [ "$node_ok" -eq 0 ]; then
    os_major="$(printf '%s' "$VERSION_ID" | cut -d. -f1)"
    case "$os_major" in ''|*[!0-9]*) echo 'Could not determine the Debian/Ubuntu release. Install Node.js 18+ manually, then retry.' >&2; exit 1 ;; esac
    minimum_os=12
    if [ "$ID" = ubuntu ]; then minimum_os=24; fi
    if [ "$os_major" -lt "$minimum_os" ]; then
      echo 'This release may not provide Node.js 18+ from its default repositories. Use Debian 12+, Ubuntu 24.04+, or install Node.js 18+ manually, then retry.' >&2
      exit 1
    fi
  fi
  command -v sudo >/dev/null 2>&1 || { echo 'Install Node.js 18+, npm, curl, unzip, and Chromium, then retry.' >&2; exit 1; }
  sudo -n true || { echo 'This host needs passwordless sudo for the one-time runtime/browser package install. Install the prerequisites manually, then retry.' >&2; exit 1; }
  sudo -n apt-get update
  if [ "$ID" = ubuntu ]; then browser_package=chromium-browser; else browser_package=chromium; fi
  sudo -n apt-get install -y nodejs npm curl unzip ca-certificates "$browser_package"
fi

command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo 'Node.js and npm are required.' >&2; exit 1; }
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$node_major" -ge 18 ] || { echo 'Node.js 18 or newer is required; update the host image and retry.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 || { echo 'curl and unzip are required to install Bun.' >&2; exit 1; }

bun_ok=0
if command -v bun >/dev/null 2>&1; then
  bun_version="$(bun --version)"
  if node -e 'const [a,b]=process.argv[1].split(".").map(Number);process.exit(a>1||(a===1&&b>=1)?0:1)' "$bun_version"; then bun_ok=1; fi
fi
if [ "$bun_ok" -eq 0 ]; then
  echo 'Installing Bun for this user...'
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null 2>&1 || { echo 'Bun installation did not produce ~/.bun/bin/bun.' >&2; exit 1; }
bun_version="$(bun --version)"
node -e 'const [a,b]=process.argv[1].split(".").map(Number);process.exit(a>1||(a===1&&b>=1)?0:1)' "$bun_version" || { echo 'Bun 1.1 or newer is required.' >&2; exit 1; }

command -v systemctl >/dev/null 2>&1 && command -v loginctl >/dev/null 2>&1 || { echo 'A systemd host is required for a service that survives logout and reboot.' >&2; exit 1; }
linger="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)"
if [ "$linger" != yes ]; then
  command -v sudo >/dev/null 2>&1 && sudo -n loginctl enable-linger "$(id -un)" || { echo 'Could not enable the user service after logout. Enable it with: sudo loginctl enable-linger '"$(id -un)" >&2; exit 1; }
fi

echo 'Installing DeepSeek Code on this host...'
npm install --global --prefix "$HOME/.local" '@hermenics/deepseek-code@latest'
[ -x "$HOME/.local/bin/deepseek" ] || { echo 'The npm install did not create ~/.local/bin/deepseek.' >&2; exit 1; }
mkdir -p "$HOME/.deepseek-pods/.deepseek/bots" "$HOME/.config/systemd/user"
chmod 700 "$HOME/.deepseek-pods" "$HOME/.deepseek-pods/.deepseek" "$HOME/.deepseek-pods/.deepseek/bots"
echo 'Host runtime and package are ready.'
`

const WRITE_CREDENTIALS = String.raw`const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
try{
 const input=JSON.parse(fs.readFileSync(0,"utf8"));
 const p=input&&input.profile,t=input&&input.token;
 if(!p||p.provider!=="deepseek"||typeof p.apiKey!=="string"||!p.apiKey||typeof t!=="string"||t.length<32||/[\r\n]/.test(t)) throw new Error();
 const root=path.join(os.homedir(),".deepseek-pods"),config=path.join(root,".deepseek");
 fs.mkdirSync(config,{recursive:true,mode:0o700});fs.chmodSync(root,0o700);fs.chmodSync(config,0o700);
 const write=(file,data)=>{const temp=file+"."+process.pid+".tmp";fs.writeFileSync(temp,data,{encoding:"utf8",mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600)};
 write(path.join(config,"provider-profiles.json"),JSON.stringify({version:1,profiles:[p]},null,2)+"\n");
 write(path.join(config,"pods-host.env"),"DEEPSEEK_BOTS_TOKEN="+t+"\n");
}catch{process.stderr.write("Could not install the private Pods host configuration.\n");process.exitCode=1}
`

const INSTALL_SERVICE = String.raw`set -eu
unit="$HOME/.config/systemd/user/deepseek-pods.service"
cat > "$unit" <<'UNIT'
[Unit]
Description=DeepSeek Pods supervisor
After=network-online.target

[Service]
Type=simple
Environment=HOME=%h/.deepseek-pods
Environment=PATH=%h/.local/bin:%h/.bun/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=%h/.deepseek-pods/.deepseek/pods-host.env
WorkingDirectory=%h/.deepseek-pods
ExecStart=%h/.local/bin/deepseek pods --db %h/.deepseek-pods/.deepseek/bots/state.db serve --web --host 127.0.0.1 --port 8787 --concurrency 2
Restart=on-failure
RestartSec=5
UMask=0077
KillMode=control-group

[Install]
WantedBy=default.target
UNIT
chmod 600 "$unit"
systemctl --user daemon-reload
systemctl --user enable deepseek-pods.service
if systemctl --user is-active --quiet deepseek-pods.service; then
  systemctl --user restart deepseek-pods.service
else
  systemctl --user start deepseek-pods.service
fi
systemctl --user --no-pager --full status deepseek-pods.service | sed -n '1,12p'
`

interface HostOptions { target: string; identityFile?: string; sshPort?: number }

function validateOptions(options: HostOptions): void {
  if (!/^[A-Za-z0-9._@:\[\]-]+$/.test(options.target) || options.target.startsWith('-') || options.target.includes('..')) {
    throw new Error('SSH target must be a host, SSH config alias, or user@host (without shell characters).')
  }
  if (options.sshPort !== undefined && (!Number.isSafeInteger(options.sshPort) || options.sshPort < 1 || options.sshPort > 65535)) {
    throw new Error('--ssh-port must be an integer between 1 and 65535.')
  }
  if (options.identityFile) {
    try { if (!statSync(options.identityFile).isFile()) throw new Error() }
    catch { throw new Error(`SSH identity file does not exist: ${options.identityFile}`) }
  }
}

function sshArgs(options: HostOptions, remoteCommand: string): string[] {
  return [
    ...(options.identityFile ? ['-i', options.identityFile, '-o', 'IdentitiesOnly=yes'] : []),
    ...(options.sshPort ? ['-p', String(options.sshPort)] : []),
    '--', options.target, remoteCommand,
  ]
}

async function ssh(options: HostOptions, command: string, input?: string): Promise<void> {
  const proc = Bun.spawn(['ssh', ...sshArgs(options, command)], {
    stdin: input === undefined ? 'inherit' : 'pipe', stdout: 'inherit', stderr: 'inherit',
  })
  if (input !== undefined) {
    if (!proc.stdin) throw new Error('SSH input pipe was not available for the provider profile.')
    proc.stdin.write(input)
    proc.stdin.end()
  }
  const code = await proc.exited
  if (code !== 0) throw new Error(`SSH command failed with exit code ${code}. The host may be partially prepared; rerun the same command to continue.`)
}

async function confirm(): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Host installation needs an interactive terminal so its remote changes can be confirmed.')
  const input = createInterface({ input: stdin, output: stdout })
  try { return ['y', 'yes'].includes((await input.question('Continue? [y/N] ')).trim().toLowerCase()) }
  finally { input.close() }
}

export async function installPodsHost(options: HostOptions): Promise<void> {
  validateOptions(options)
  const { providerConfig } = await loadSavedConfig()
  if (!providerConfig || providerConfig.provider !== 'deepseek' || !providerConfig.apiKey) {
    throw new Error('Select a DeepSeek API provider profile with a saved API key before deploying a Pods host.')
  }
  if (providerConfig.baseURL) {
    let url: URL
    try { url = new URL(providerConfig.baseURL) } catch { throw new Error('The saved DeepSeek Base URL is invalid.') }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname === '0.0.0.0' || /^127\./.test(hostname)
    if (url.protocol !== 'https:' || url.username || url.password || loopback) {
      throw new Error('Remote Pods require an HTTPS DeepSeek endpoint reachable from the host; local and unauthenticated HTTP endpoints are not supported.')
    }
  }
  const profile = {
    id: 'deepseek-pods-host', name: 'DeepSeek API (Pods host)', provider: 'deepseek' as const,
    apiKey: providerConfig.apiKey, baseURL: providerConfig.baseURL,
    model: providerConfig.model, vision: providerConfig.vision,
  }
  const token = randomBytes(32).toString('base64url')

  console.log(`\nDeepSeek Pods will install on ${options.target} over SSH.`)
  console.log('The installer may use passwordless sudo to install Node.js, Chromium, and system packages on Debian/Ubuntu.')
  console.log('It installs Bun and the latest published DeepSeek Code package, enables a persistent user service, and stores this DeepSeek API profile on the host with owner-only permissions.')
  console.log('The API profile is sent through SSH standard input. The panel binds only to 127.0.0.1:8787; this does not open a public port or provision a cloud VM.')
  console.log('Your existing local Pods database is not copied; the remote host starts with a separate database.')
  if (!await confirm()) { console.log('Cancelled.'); return }

  console.log('\nPreparing a Debian/Ubuntu host (Node.js, npm, Chromium, Bun, npm package, systemd linger)...')
  await ssh(options, 'bash -s', BOOTSTRAP)

  console.log('Sending the selected DeepSeek provider profile through the encrypted SSH connection...')
  const payload = JSON.stringify({ profile, token })
  await ssh(options, `node -e '${WRITE_CREDENTIALS}'`, payload)

  console.log('Starting the isolated Pods supervisor and loopback-only web panel...')
  await ssh(options, 'bash -s', INSTALL_SERVICE)

  const tunnelArgs = [
    'ssh', ...(options.identityFile ? ['-i', options.identityFile] : []),
    ...(options.sshPort ? ['-p', String(options.sshPort)] : []),
    '-N', '-L', '8787:127.0.0.1:8787', options.target,
  ]
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
  console.log('\nPods host is installed and running. To open its panel from this computer:')
  console.log(`  ${tunnelArgs.map(quote).join(' ')}`)
  console.log('Then visit http://127.0.0.1:8787 and sign in with this one-time displayed token:')
  console.log(`  ${token}`)
  console.log('Keep the SSH tunnel open while using the panel. The Pods service itself keeps running on the host after your computer disconnects.')
}
