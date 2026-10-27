// Vercel entry point: every /api/... request is sent here (see vercel.json)
// and handled by the same Express app that server.js runs on your computer.
import app from '../backend/server/app.js';

export default app;
