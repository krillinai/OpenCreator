const { app, utilityProcess } = require('electron');
const path = require('node:path');

void app.whenReady().then(() => {
  const child = utilityProcess.fork(
    path.join(__dirname, 'keyring-utility-child-2026-07-30.cjs'),
    [],
    {
      env: {
        ...process.env,
        CLAWEE_KEYRING_MODULE_ROOT: path.resolve(
          __dirname,
          '../apps/desktop/release/mac-arm64/Clawee.app/Contents/Resources/daemon'
        )
      },
      serviceName: 'Clawee Keyring Diagnostic',
      stdio: 'pipe'
    }
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.once('exit', code => {
    process.exitCode = code ?? 1;
    app.quit();
  });
});
