/// <reference lib="dom" />
import { boot } from './client.js'

// The bundle's entry, kept apart from client.ts so tests can import boot()
// without it running against whatever document the test environment has.
boot(document, window)
