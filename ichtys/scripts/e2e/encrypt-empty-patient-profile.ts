import { encryptProfileJson } from '../../apps/web/lib/subjects/phi-fields'

// Emit the application's real encrypted representation of an empty profile.
// The caller should capture stdout directly into a shell variable, not a log.
process.stdout.write(encryptProfileJson({}))
