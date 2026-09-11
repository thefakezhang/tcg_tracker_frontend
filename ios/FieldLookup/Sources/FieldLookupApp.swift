import SwiftUI

@main
struct FieldLookupApp: App {
    var body: some Scene {
        WindowGroup {
            AppBootstrapView()
        }
    }
}

struct AppBootstrapView: View {
    var body: some View {
        #if DEBUG
        if let scenario = UITestScenario.current {
            UITestScenarioView(scenario: scenario)
        } else {
            ProductionRootView()
        }
        #else
        ProductionRootView()
        #endif
    }
}

struct ProductionRootView: View {
    @StateObject private var coordinator: AppCoordinator

    init() {
        _coordinator = StateObject(wrappedValue: FieldLookupComposition.makeCoordinator())
    }

    var body: some View {
        AppRootView(coordinator: coordinator)
            .task {
                await coordinator.restoreIfNeeded()
            }
            .onOpenURL { url in
                coordinator.handleOpenURL(url)
            }
    }
}

struct AppRootView: View {
    @ObservedObject var coordinator: AppCoordinator

    var body: some View {
        Group {
            switch coordinator.state {
            case .checking:
                LaunchProgressView()
            case let .signedOut(message):
                SignInView(message: message) {
                    Task { await coordinator.signIn() }
                }
            case let .authorized(session):
                AuthorizedLookupView(coordinator: coordinator, session: session)
                    .id(session.userID)
            case let .denied(role, email):
                AccessDeniedView(role: role, email: email) {
                    Task { await coordinator.signOut() }
                }
            case let .configurationFailure(message):
                ConfigurationFailureView(message: message)
            }
        }
        .tint(.indigo)
    }
}

private struct AuthorizedLookupView: View {
    @ObservedObject var coordinator: AppCoordinator
    @StateObject private var viewModel: FieldLookupViewModel

    init(coordinator: AppCoordinator, session: OperatorSession) {
        self.coordinator = coordinator
        guard let viewModel = coordinator.makeViewModel(for: session) else {
            preconditionFailure("Authorized state requires lookup dependencies")
        }
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        FieldLookupScreen(
            viewModel: viewModel,
            accountLabel: sessionLabel,
            onSignOut: {
                Task { await coordinator.signOut() }
            }
        )
    }

    private var sessionLabel: String {
        if case let .authorized(session) = coordinator.state {
            return session.email ?? "Administrator"
        }
        return "Administrator"
    }
}

private struct LaunchProgressView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "rectangle.and.text.magnifyingglass")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.indigo)
            ProgressView("Checking session")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("session-checking")
    }
}

struct SignInView: View {
    let message: String?
    let onSignIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Spacer()
            Image(systemName: "rectangle.and.text.magnifyingglass")
                .font(.system(size: 52, weight: .semibold))
                .foregroundStyle(.indigo)
            VStack(alignment: .leading, spacing: 8) {
                Text("Field Lookup")
                    .font(.largeTitle.bold())
                Text("Search Pokémon cards in a shop and inspect the current read-only buying signal.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            if let message {
                NoticeBanner(
                    title: "Sign-in needed",
                    message: message,
                    systemImage: "clock.badge.exclamationmark",
                    tone: .warning
                )
                .accessibilityIdentifier("session-message")
            }
            Button(action: onSignIn) {
                Label("Continue with Google", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("google-sign-in")
            Text("Administrator access is required. Buyer, unmapped, and generic authenticated sessions are denied.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

private struct AccessDeniedView: View {
    let role: PrincipalRole
    let email: String?
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Spacer()
            Image(systemName: "person.crop.circle.badge.xmark")
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(.orange)
            Text("Operator access unavailable")
                .font(.largeTitle.bold())
            Text(role.accessMessage)
                .font(.body)
            if let email {
                Text(email)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
            }
            Button("Sign out", action: onSignOut)
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
                .accessibilityIdentifier("denied-sign-out")
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

private struct ConfigurationFailureView: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.orange)
            Text("Setup required")
                .font(.largeTitle.bold())
            Text(message)
            Text("Copy Config/Secrets.xcconfig.example to Secrets.xcconfig, add the public project values, and register the documented callback URL.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}
