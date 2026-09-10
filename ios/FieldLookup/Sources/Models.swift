import Foundation

enum PrincipalRole: String, Codable, Equatable, Sendable {
    case administrator
    case buyer
    case unmapped
    case authenticated
    case unknown

    var accessMessage: String {
        switch self {
        case .administrator:
            return "Administrator access confirmed."
        case .buyer:
            return "Buyer accounts cannot open the operator field lookup."
        case .unmapped:
            return "This Google account is not mapped to an application principal."
        case .authenticated:
            return "This session has a generic authenticated role. Sign in again after the administrator mapping hook is active."
        case .unknown:
            return "This session does not carry a recognized application role."
        }
    }
}

struct OperatorSession: Equatable, Sendable {
    let userID: String
    let email: String?
    let accessToken: String
    let expiresAt: Date
    let role: PrincipalRole
}

struct CardIdentity: Codable, Equatable, Identifiable, Sendable {
    let cardID: Int
    let cardUID: String?
    let regionalName: String
    let englishName: String?
    let setCode: String
    let cardNumber: String?
    let variant: String?
    let imageURL: URL?
    let language: String?

    var id: Int { cardID }

    var displayName: String {
        regionalName
    }

    var secondaryName: String? {
        guard let englishName, englishName.caseInsensitiveCompare(regionalName) != .orderedSame else {
            return nil
        }
        return englishName
    }

    var identityLine: String {
        [setCode, cardNumber].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }.joined(separator: " ")
    }
}

enum PriceKind: String, Codable, Equatable, Sendable {
    case ask
    case bid
    case sold
    case valuation
    case unknown

    var exitLabel: String {
        switch self {
        case .ask:
            return "Ask"
        case .bid:
            return "Shop bid"
        case .sold:
            return "Sold comp"
        case .valuation:
            return "Valuation"
        case .unknown:
            return "Unknown signal"
        }
    }

    var evidenceNote: String {
        switch self {
        case .bid:
            return "Observed shop bid. Availability can change."
        case .sold:
            return "Completed-sale evidence, not a current shop offer."
        case .valuation:
            return "Estimated market value, not a current shop offer."
        case .ask:
            return "Observed asking price."
        case .unknown:
            return "The summary does not identify this signal type."
        }
    }
}

struct PriceSignal: Codable, Equatable, Sendable {
    let price: Double?
    let currency: String?
    let symbol: String?
    let location: String?
    let region: String?
    let normalizedUSD: Double?
    let kind: PriceKind

    var originalPriceLabel: String {
        guard let price else { return "Unavailable" }
        let amount = price.formatted(.number.precision(.fractionLength(0 ... 2)))
        if let symbol, !symbol.isEmpty {
            return "\(symbol)\(amount)"
        }
        if let currency, !currency.isEmpty {
            return "\(currency) \(amount)"
        }
        return amount
    }

    var normalizedPriceLabel: String? {
        guard let normalizedUSD else { return nil }
        return normalizedUSD.formatted(.currency(code: "USD"))
    }
}

enum InventoryAvailability: Codable, Equatable, Sendable {
    case known(owned: Int, incoming: Int, consigned: Int, available: Int)
    case unknown

    var conciseLabel: String {
        switch self {
        case let .known(owned, incoming, _, _):
            if incoming > 0 {
                return "Owned \(owned) + \(incoming) incoming"
            }
            return "Owned \(owned)"
        case .unknown:
            return "Owned quantity unknown"
        }
    }
}

struct CardLookupResult: Codable, Equatable, Identifiable, Sendable {
    let card: CardIdentity
    let entry: PriceSignal?
    let exit: PriceSignal?
    let roi: Double?
    let summaryRefreshedAt: Date?
    let inventory: InventoryAvailability

    var id: Int { card.cardID }

    var directionLabel: String? {
        guard let entryRegion = entry?.region, let exitRegion = exit?.region else {
            return nil
        }
        return "\(entryRegion) → \(exitRegion)"
    }

    var roiLabel: String {
        guard let roi, entry != nil, exit != nil else { return "ROI unavailable" }
        return roi.formatted(.percent.precision(.fractionLength(1)))
    }
}

enum ResultProvenance: Equatable, Sendable {
    case live(loadedAt: Date)
    case cached(savedAt: Date, stale: Bool)
}

enum LookupState: Equatable, Sendable {
    case idle
    case loading
    case loaded(results: [CardLookupResult], provenance: ResultProvenance)
    case empty
    case failure(message: String)
    case cacheExpired(savedAt: Date)
    case sessionExpired
}

enum FieldLookupError: Error, Equatable, LocalizedError, Sendable {
    case invalidSearch
    case networkUnavailable
    case sessionExpired
    case accessDenied(PrincipalRole)
    case userChanged
    case server(status: Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidSearch:
            return "Enter a card name or printed number."
        case .networkUnavailable:
            return "The network is unavailable."
        case .sessionExpired:
            return "Your session expired. Sign in again to continue."
        case let .accessDenied(role):
            return role.accessMessage
        case .userChanged:
            return "The signed-in account changed. Sign in again before searching."
        case let .server(status):
            return "The lookup service returned HTTP \(status)."
        case .invalidResponse:
            return "The lookup response could not be read."
        }
    }
}

enum FieldLookupDate {
    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let formatter = ISO8601DateFormatter()

    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        return fractionalFormatter.date(from: value) ?? formatter.date(from: value)
    }
}
