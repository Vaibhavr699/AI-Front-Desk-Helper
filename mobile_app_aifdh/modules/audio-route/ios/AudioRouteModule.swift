import AVFoundation
import ExpoModulesCore

public class AudioRouteModule: Module {
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AudioRoute")

    Events("onChange")

    Function("isExternalAudioConnected") { () -> Bool in
      AudioRouteModule.hasExternalOutput()
    }

    OnStartObserving {
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onChange", ["connected": AudioRouteModule.hasExternalOutput()])
      }
    }

    OnStopObserving {
      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
        self.routeObserver = nil
      }
    }
  }

  private static func hasExternalOutput() -> Bool {
    let externalPorts: Set<AVAudioSession.Port> = [
      .bluetoothA2DP,
      .bluetoothLE,
      .bluetoothHFP,
      .headphones,
      .usbAudio,
      .carAudio,
    ]
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains {
      externalPorts.contains($0.portType)
    }
  }
}
