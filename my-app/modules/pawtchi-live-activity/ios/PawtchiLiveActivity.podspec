Pod::Spec.new do |s|
  s.name           = 'PawtchiLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'ActivityKit control surface for the Pawtchi walk Live Activity.'
  s.description    = 'Starts, updates and ends the Lock Screen / Dynamic Island card for an in-progress tracked walk. Read-only mirror of walk state; it can never influence location tracking.'
  s.author         = 'Pawtchi'
  s.homepage       = 'https://pawtchi.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # WalkActivityAttributes.swift is a byte-identical copy of the widget target's
  # file. Reaching out to the original with '../../../targets/...' does NOT work:
  # CocoaPods silently drops source_files that resolve outside the podspec's own
  # directory, and the build fails with "cannot find type 'PawtchiWalkAttributes'".
  # lib/walk/liveActivityAttributes.test.ts is what keeps the two copies honest.
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
