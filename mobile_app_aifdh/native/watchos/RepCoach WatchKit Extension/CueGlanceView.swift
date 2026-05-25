import SwiftUI

struct CueGlanceView: View {
    @EnvironmentObject var cueManager: CueManager

    var body: some View {
        ZStack {
            backgroundColor
                .ignoresSafeArea()

            if cueManager.isActive {
                VStack(spacing: 8) {
                    Text(cueManager.currentLabel)
                        .font(.system(size: 36, weight: .heavy, design: .rounded))
                        .foregroundColor(labelColor)
                        .minimumScaleFactor(0.6)

                    if !cueManager.currentHeadline.isEmpty {
                        Text(cueManager.currentHeadline)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                }
                .padding()
                .transition(.opacity)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "ear")
                        .font(.system(size: 28))
                        .foregroundColor(.gray)
                    Text("Listening…")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.gray)
                }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: cueManager.isActive)
    }

    private var backgroundColor: Color {
        switch cueManager.currentUrgency {
        case "green": return Color(red: 0.05, green: 0.2, blue: 0.1)
        case "yellow": return Color(red: 0.25, green: 0.2, blue: 0.0)
        case "orange": return Color(red: 0.3, green: 0.15, blue: 0.0)
        case "red": return Color(red: 0.3, green: 0.05, blue: 0.05)
        default: return .black
        }
    }

    private var labelColor: Color {
        switch cueManager.currentUrgency {
        case "green": return .green
        case "yellow": return .yellow
        case "orange": return .orange
        case "red": return .red
        default: return .white
        }
    }
}
