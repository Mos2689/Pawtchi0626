// Node-env test stub for posthog-react-native.
//
// The library ships an ESM bundle whose top-level code touches native modules
// (react-native, storage), which ts-jest cannot parse in a Node test env. The
// tests under lib/ only exercise the analytics module's sink routing — the
// PostHog sink is out of scope. This stub exposes just enough surface for a
// `new PostHog(...)` call to succeed at module load.

export default class PostHog {
  constructor(_key?: string, _opts?: Record<string, unknown>) {}
  capture(_event: string, _props?: Record<string, unknown>): void {}
  identify(_id: string): void {}
  reset(): void {}
  flush(): Promise<void> { return Promise.resolve(); }
  screen(_name: string, _props?: Record<string, unknown>): void {}
}
