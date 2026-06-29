/**
 * Minimal static file server for the Skribbl Premium frontend.
 * Listens on PORT (default 3000) and serves /app/frontend recursively.
 */
const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const root = __dirname;
app.disable('etag');
app.use((req, res, next) => {
  // Disable caching during development so users always see latest
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(root, { extensions: ['html'] }));

// SPA-style fallback: always serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[frontend] static server listening on http://${HOST}:${PORT}`);
});
