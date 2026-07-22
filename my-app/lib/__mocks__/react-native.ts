// Node-env test stub for react-native.
//
// react-native ships a Flow/ESM entrypoint (index.js.flow) that ts-jest cannot
// parse in a Node test env. A few pure-data modules under constants/ import a
// sliver of react-native (currently just `Platform`, used by `makeShadow` in
// constants/design.ts). Those modules get pulled into the lib/ test suite
// transitively (e.g. buildVetReportHTML.test.ts). This stub exposes just enough
// surface for those imports to resolve. Add to it only as needed.

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  select: <T,>(obj: { ios?: T; android?: T; default?: T; native?: T }): T | undefined =>
    obj.ios ?? obj.native ?? obj.default,
};
