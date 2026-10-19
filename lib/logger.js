// Structured logging for the server process. JSON lines go to a file;
// the mock test server keeps its plain console output.
import path from "node:path"
import { fileURLToPath } from "node:url"
import pino from "pino"

const DEFAULT_LOG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../logs/app.log"
)

/** @type {ReturnType<typeof pino.destination>} */
const destination = pino.destination({
  dest: process.env.LOG_FILE ?? DEFAULT_LOG_FILE,
  mkdir: true,
  // Synchronous writes: the log volume is small and this guarantees every
  // line reaches the file even when the process exits right after logging.
  sync: true
})

/** @type {import("pino").Logger} */
const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  destination
)

export default logger