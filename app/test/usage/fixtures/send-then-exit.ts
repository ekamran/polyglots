// Spawned by send.test.ts: starts a usage send the way the CLI does, without
// awaiting it, and then has nothing left to do. The process must exit at once
// rather than wait for an endpoint that never answers.
import { sendUsageInBackground } from '../../../src/usage/index.js'

void sendUsageInBackground({ version: '0.0.0-test' })
