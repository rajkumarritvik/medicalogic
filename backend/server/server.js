// MedicaLogic backend v2 - run on your computer with:  node server.js
// (The routes live in app.js; on Vercel, api/index.js uses the same app.)
import app, { info } from './app.js';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`MedicaLogic server v2 running on http://localhost:${PORT}`);
  console.log(`Curated myths loaded: ${info.loaded} (hidden as holdout: ${info.hidden}) from ${info.path}`);
  if (!process.env.GROQ_API_KEY) console.log('WARNING: GROQ_API_KEY is not set in server/.env');
});
