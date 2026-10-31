// The real `server-only` package throws unless it is resolved under Next's
// "react-server" condition. Tests run in plain Node, so it is aliased to this
// no-op in vitest.config.ts.
export {};
