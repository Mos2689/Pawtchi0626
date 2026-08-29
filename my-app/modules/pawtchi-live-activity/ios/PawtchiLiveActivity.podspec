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

  # The ActivityAttributes struct is DELIBERATELY not copied here. ActivityKit
  # encodes ContentState in this target and decodes it in the widget extension;
  # two definitions that drift by one field name produce a card that silently
  # stops updating instead of a build error. One file, compiled into both.
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}', '../../../targets/walk-activity/WalkActivityAttributes.swift'
end
