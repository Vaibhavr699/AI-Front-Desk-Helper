import Foundation
import WatchConnectivity

@objc(WatchBridge)
class WatchBridge: NSObject, WCSessionDelegate {

    private var session: WCSession?

    override init() {
        super.init()
    }

    @objc
    func activateSession() {
        guard WCSession.isSupported() else { return }
        session = WCSession.default
        session?.delegate = self
        session?.activate()
    }

    @objc
    func sendMessage(_ message: NSDictionary, _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock) {
        guard let session = session, session.isReachable else {
            reject("UNREACHABLE", "Watch is not reachable", nil)
            return
        }
        let dict = message as? [String: Any] ?? [:]
        session.sendMessage(dict, replyHandler: { reply in
            resolve(reply)
        }, errorHandler: { error in
            reject("SEND_FAILED", error.localizedDescription, error)
        })
    }

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
