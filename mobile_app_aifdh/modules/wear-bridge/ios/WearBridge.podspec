Pod::Spec.new do |s|
  s.name           = 'WearBridge'
  s.version        = '1.0.0'
  s.summary        = 'Phone-to-watch coaching cue bridge'
  s.description    = 'Sends real-time coaching cues to a paired Apple Watch via WatchConnectivity.'
  s.author         = ''
  s.homepage       = 'https://airepcoach.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
