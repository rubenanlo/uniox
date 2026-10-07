/**
 * electron-builder afterSign hook: ad-hoc sign the packaged .app.
 *
 * electron-builder 26 skips macOS signing entirely when no identity is
 * configured, leaving only the linker's placeholder signature
 * (Identifier=Electron, flags=linker-signed). macOS refuses notification
 * centre registration for such binaries (UNErrorDomain 1), so alerts fall
 * back to osascript banners. A real ad-hoc signature (`codesign -s -`)
 * stamps the bundle with its CFBundleIdentifier and lets the app register
 * under its own name and icon.
 *
 * When a Developer ID is provided via CSC_LINK, electron-builder signs the
 * app itself and this hook must not re-sign over it.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
