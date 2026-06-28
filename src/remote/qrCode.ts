// ponytail: qrcode-terminal is the installed dep; no custom renderer needed
import qrcodeTerminal from 'qrcode-terminal'

export function renderPairingQR(params: {
  sessionId: string
  relayUrl: string
  cliPublicKey: string
}): void {
  const url = `dsc://pair?s=${params.sessionId}&r=${encodeURIComponent(params.relayUrl)}&k=${params.cliPublicKey}`
  qrcodeTerminal.generate(url, { small: true })
  console.log(`\n${url}\n`)
}
