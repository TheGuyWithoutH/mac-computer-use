#!/usr/bin/env node

import { startServer } from "./server.js";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === undefined || command === "server") {
    await startServer();
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`mac-use

Usage:
  mac-use            Start the MCP stdio server
  mac-use server     Start the MCP stdio server
  mac-use --help     Show this help

Environment:
  COMPUTER_USE_BACKEND=cli      Use the fallback CLI backend
  MAC_USE_CACHE_DIR=<path>      Override the Swift helper build cache
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
