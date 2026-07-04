require('dotenv').config({ quiet: true });

const app = require('./app');
const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';
const shutdownTimeoutMs =
  Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

const server = app.listen(port, host, () => {
  console.log(`Hotel Price API listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing HTTP server.`);

  const forceShutdownTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, shutdownTimeoutMs);
  forceShutdownTimer.unref();

  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed.', error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
