import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createTradingMcp } from './tools.js';
serveStdio(createTradingMcp);
