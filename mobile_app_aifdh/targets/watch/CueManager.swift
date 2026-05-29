import Foundation
import WatchConnectivity
import WatchKit

class CueManager: NSObject, ObservableObject, WCSessionDelegate {
    @Published var currentLabel: String = ""
    @Published var currentUrgency: String = ""
    @Published var currentHeadline: String = ""
    @Published var isActive: Bool = false

    private var dismissTimer: Timer?

    override init() {
        super.init()
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.handleMessage(message)
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            self.handleMessage(message)
            replyHandler(["received": true])
        }
    }

    private func handleMessage(_ message: [String: Any]) {
        guard let label = message["label"] as? String else { return }
        let urgency = message["urgency"] as? String ?? "yellow"

        if urgency == "clear" {
            clearCue()
            return
        }

        currentLabel = label
        currentUrgency = urgency
        currentHeadline = message["headline"] as? String ?? ""
        isActive = true

        fireHaptic(for: message["vibration"] as? String ?? "single_tap")

        dismissTimer?.invalidate()
        dismissTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                self?.clearCue()
            }
        }
    }

    private func fireHaptic(for vibration: String) {
        switch vibration {
        case "double_tap":
            WKInterfaceDevice.current().play(.click)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                WKInterfaceDevice.current().play(.click)
            }
        case "long_buzz":
            WKInterfaceDevice.current().play(.notification)
        default:
            WKInterfaceDevice.current().play(.click)
        }
    }

    func clearCue() {
        dismissTimer?.invalidate()
        currentLabel = ""
        currentUrgency = ""
        currentHeadline = ""
        isActive = false
    }
}
