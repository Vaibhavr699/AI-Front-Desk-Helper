import ExpoModulesCore
import WatchConnectivity

final class WatchSessionManager: NSObject, WCSessionDelegate {
  static let shared = WatchSessionManager()

  private override init() {
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  func send(_ dict: [String: Any]) -> Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      return false
    }
    session.sendMessage(dict, replyHandler: nil, errorHandler: nil)
    return true
  }

  func isConnected() -> Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    return session.isPaired && session.isWatchAppInstalled
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }
}

public class WearBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WearBridge")

    OnCreate {
      WatchSessionManager.shared.activate()
    }

    AsyncFunction("sendCue") { (payloadJson: String) -> Bool in
      guard
        let data = payloadJson.data(using: .utf8),
        let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        return false
      }
      return WatchSessionManager.shared.send(dict)
    }

    AsyncFunction("clearCue") { () -> Bool in
      return WatchSessionManager.shared.send(["urgency": "clear"])
    }

    AsyncFunction("isWatchConnected") { () -> Bool in
      return WatchSessionManager.shared.isConnected()
    }
  }
}
