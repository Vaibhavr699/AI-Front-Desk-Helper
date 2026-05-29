import SwiftUI

@main
struct RepCoachApp: App {
    @StateObject private var cueManager = CueManager()

    var body: some Scene {
        WindowGroup {
            CueGlanceView()
                .environmentObject(cueManager)
        }
    }
}
