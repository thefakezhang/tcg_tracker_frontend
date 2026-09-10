import SwiftUI

struct FieldLookupScreen: View {
    @ObservedObject var viewModel: FieldLookupViewModel
    let accountLabel: String
    let onSignOut: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    searchPanel
                    stateContent
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Field Lookup")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Text(accountLabel)
                        Button("Sign out", role: .destructive, action: onSignOut)
                    } label: {
                        Image(systemName: "person.crop.circle")
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Account and sign out")
                    .accessibilityIdentifier("account-menu")
                }
            }
        }
    }

    private var searchPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pokémon card")
                .font(.headline)
            TextField("Name or printed number", text: $viewModel.queryText)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .frame(minHeight: 44)
                .accessibilityLabel("Card name or printed number")
                .accessibilityIdentifier("card-search-field")
                .onSubmit {
                    Task { await viewModel.search() }
                }
            Button {
                Task { await viewModel.search() }
            } label: {
                Label("Search", systemImage: "magnifyingglass")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.state == .loading)
            .accessibilityIdentifier("search-button")
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
        .padding(.top, 8)
    }

    @ViewBuilder
    private var stateContent: some View {
        switch viewModel.state {
        case .idle:
            EmptyPromptView(
                title: "Ready in the shop",
                message: "Search Japanese or English names, set codes, or printed numbers."
            )
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text("Loading current summaries")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 180)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lookup-loading")
        case let .loaded(results, provenance):
            ResultList(results: results, provenance: provenance)
        case .empty:
            EmptyPromptView(
                title: "No cards found",
                message: "Check the spelling or try a shorter printed number."
            )
            retryButton
        case let .failure(message):
            NoticeBanner(
                title: "Lookup failed",
                message: message,
                systemImage: "wifi.exclamationmark",
                tone: .error
            )
            .accessibilityIdentifier("lookup-error")
            retryButton
        case let .cacheExpired(savedAt):
            NoticeBanner(
                title: "Cached result expired",
                message: "The last saved result is from \(savedAt.formatted(date: .abbreviated, time: .shortened)). Connect to refresh it.",
                systemImage: "clock.badge.xmark",
                tone: .warning
            )
            .accessibilityIdentifier("cache-expired")
            retryButton
        case .sessionExpired:
            NoticeBanner(
                title: "Session expired",
                message: "Sign in again before viewing operator data.",
                systemImage: "person.crop.circle.badge.exclamationmark",
                tone: .warning
            )
            .accessibilityIdentifier("lookup-session-expired")
        }
    }

    @ViewBuilder
    private var retryButton: some View {
        if viewModel.canRetry {
            Button {
                Task { await viewModel.retry() }
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("retry-button")
        }
    }
}

private struct ResultList: View {
    let results: [CardLookupResult]
    let provenance: ResultProvenance

    var body: some View {
        VStack(spacing: 12) {
            provenanceBanner
            HStack {
                Text("\(results.count) result\(results.count == 1 ? "" : "s")")
                    .font(.subheadline.weight(.semibold))
                Spacer()
            }
            ForEach(results) { result in
                NavigationLink {
                    CardDetailView(result: result, provenance: provenance)
                } label: {
                    ResultCard(result: result)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("card-\(result.card.cardID)")
            }
        }
    }

    @ViewBuilder
    private var provenanceBanner: some View {
        switch provenance {
        case .live:
            NoticeBanner(
                title: "Live response",
                message: "Prices and stock came from the current authenticated request.",
                systemImage: "checkmark.circle.fill",
                tone: .success
            )
            .accessibilityIdentifier("live-banner")
        case let .cached(savedAt, stale):
            NoticeBanner(
                title: stale ? "Offline cached result - stale" : "Offline cached result",
                message: "Saved \(savedAt.formatted(date: .abbreviated, time: .shortened)). Values keep their original summary refresh times.",
                systemImage: stale ? "clock.badge.exclamationmark" : "arrow.down.circle",
                tone: stale ? .warning : .offline
            )
            .accessibilityIdentifier(stale ? "stale-cache-banner" : "offline-cache-banner")
        }
    }
}

private struct ResultCard: View {
    let result: CardLookupResult

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CardImage(url: result.card.imageURL, size: 78)
            VStack(alignment: .leading, spacing: 6) {
                Text(result.card.displayName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                if let secondaryName = result.card.secondaryName {
                    Text(secondaryName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(result.card.identityLine)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    if let direction = result.directionLabel {
                        Text(direction)
                            .font(.caption.bold())
                            .foregroundStyle(.indigo)
                    } else {
                        Text("Price incomplete")
                            .font(.caption.bold())
                            .foregroundStyle(.orange)
                    }
                    Text(result.roiLabel)
                        .font(.caption.bold())
                }
                Text(result.inventory.conciseLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.tertiary)
                .padding(.top, 28)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        [
            result.card.displayName,
            result.card.identityLine,
            result.directionLabel ?? "Price incomplete",
            result.roiLabel,
            result.inventory.conciseLabel,
        ].joined(separator: ", ")
    }
}

struct CardDetailView: View {
    let result: CardLookupResult
    let provenance: ResultProvenance

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 18) {
                identityHeader
                if case let .cached(savedAt, stale) = provenance {
                    NoticeBanner(
                        title: stale ? "Cached offline - stale" : "Cached offline",
                        message: "Saved \(savedAt.formatted(date: .abbreviated, time: .shortened)).",
                        systemImage: "wifi.slash",
                        tone: stale ? .warning : .offline
                    )
                }
                decisionSection
                inventorySection
                freshnessSection
            }
            .padding(16)
            .containerRelativeFrame(.horizontal, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Card detail")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var identityHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardImage(url: result.card.imageURL, size: 260)
                .frame(maxWidth: .infinity)
            Text(result.card.displayName)
                .font(.title2.bold())
                .accessibilityIdentifier("detail-card-name")
            if let secondaryName = result.card.secondaryName {
                Text(secondaryName)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                IdentityChip(text: result.card.setCode)
                if let cardNumber = result.card.cardNumber {
                    IdentityChip(text: cardNumber)
                }
            }
            if let variant = result.card.variant {
                IdentityChip(text: variant)
            }
            IdentityChip(text: "Raw · Tier 1")
        }
        .sectionCard()
    }

    private var decisionSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Buying signal")
                    .font(.headline)
                Spacer()
                Text(result.directionLabel ?? "Direction unavailable")
                    .font(.subheadline.bold())
                    .foregroundStyle(result.directionLabel == nil ? .orange : .indigo)
                    .accessibilityIdentifier("price-direction")
            }
            PriceLegView(
                eyebrow: "ENTRY / 仕入れ",
                title: "Asking price",
                signal: result.entry,
                showKind: false,
                accessibilityID: "entry-price-leg"
            )
            Divider()
            PriceLegView(
                eyebrow: "EXIT / 売却",
                title: result.exit?.kind.exitLabel ?? "Exit unavailable",
                signal: result.exit,
                showKind: true,
                accessibilityID: "exit-price-leg"
            )
            HStack {
                Text("Summary ROI")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(result.roiLabel)
                    .font(.title3.bold())
                    .foregroundStyle(result.roi == nil ? .secondary : .primary)
                    .accessibilityIdentifier("summary-roi")
            }
        }
        .sectionCard()
    }

    private var inventorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Owned across grades")
                .font(.headline)
            Text("Catalog-level quantity for this printing across raw and graded holdings.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            switch result.inventory {
            case let .known(owned, incoming, consigned, available):
                HStack(spacing: 12) {
                    InventoryMetric(label: "Owned", value: owned)
                    InventoryMetric(label: "Incoming", value: incoming)
                    InventoryMetric(label: "Consigned", value: consigned)
                    InventoryMetric(label: "Available", value: available)
                }
                .accessibilityIdentifier("known-stock")
            case .unknown:
                NoticeBanner(
                    title: "Owned quantity unknown",
                    message: "The stock request failed. This is not a zero count.",
                    systemImage: "questionmark.circle",
                    tone: .warning
                )
                .accessibilityIdentifier("unknown-stock")
            }
        }
        .sectionCard()
    }

    private var freshnessSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Freshness")
                .font(.headline)
            if let refreshedAt = result.summaryRefreshedAt {
                Label(
                    "Summary refreshed \(refreshedAt.formatted(date: .abbreviated, time: .shortened))",
                    systemImage: "arrow.clockwise.circle"
                )
                .font(.subheadline)
                .accessibilityIdentifier("summary-refreshed-at")
            } else {
                Text("Summary refresh time unavailable")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text("Source observation time is unavailable from the summary API.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("source-time-limitation")
        }
        .sectionCard()
    }
}

private struct PriceLegView: View {
    let eyebrow: String
    let title: String
    let signal: PriceSignal?
    let showKind: Bool
    let accessibilityID: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(eyebrow)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("\(accessibilityID)-title")
                Spacer(minLength: 8)
                Text(signal?.originalPriceLabel ?? "Unavailable")
                    .font(.title3.bold())
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityIdentifier("\(accessibilityID)-price")
            }
            Text(sourceAndRegion)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("\(accessibilityID)-source")
            if let normalized = signal?.normalizedPriceLabel {
                Text("\(normalized) normalized")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityIdentifier("\(accessibilityID)-normalized")
            }
            if showKind, let signal {
                Text(signal.kind.evidenceNote)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("exit-kind-note")
            }
        }
    }

    private var sourceAndRegion: String {
        guard let signal else { return "No price summary" }
        var values: [String] = []
        if let location = signal.location, !location.isEmpty {
            values.append(location)
        }
        if let region = signal.region, !region.isEmpty {
            values.append(region)
        }
        return values.isEmpty ? "Source unavailable" : values.joined(separator: " · ")
    }
}

private struct InventoryMetric: View {
    let label: String
    let value: Int

    var body: some View {
        VStack(spacing: 4) {
            Text(String(value))
                .font(.title3.bold())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 56)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }
}

private struct CardImage: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .scaledToFit()
            case .failure:
                placeholder
            case .empty:
                ZStack {
                    placeholder
                    ProgressView()
                }
            @unknown default:
                placeholder
            }
        }
        .frame(width: size, height: size)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        Image(systemName: "rectangle.portrait")
            .font(.system(size: size * 0.28))
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct IdentityChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.monospaced())
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            .lineLimit(1)
    }
}

private struct EmptyPromptView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "rectangle.and.text.magnifyingglass")
                .font(.system(size: 34))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}

enum NoticeTone {
    case success
    case warning
    case error
    case offline

    var color: Color {
        switch self {
        case .success:
            return .green
        case .warning:
            return .orange
        case .error:
            return .red
        case .offline:
            return .indigo
        }
    }
}

struct NoticeBanner: View {
    let title: String
    let message: String
    let systemImage: String
    let tone: NoticeTone

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
                .font(.headline)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.bold())
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

private extension View {
    func sectionCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 18))
    }
}
