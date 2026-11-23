// Run the family relay locally for development: `npm run relay`, then `npm run dev`.
// Vite forwards /relay to this port.
import server from '../netlify/server/index.mjs';

const port = Number(process.env.RELAY_PORT ?? 8788);
server.listen(port, () => console.log(`Family relay listening on ws://localhost:${port}/relay`));
