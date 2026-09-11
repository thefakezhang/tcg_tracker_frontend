import Foundation

struct SearchQuery: Codable, Equatable, Sendable {
    static let maximumLength = 120
    static let maximumTokenCount = 12
    static let searchableColumns = [
        "regional_name",
        "english_name",
        "misc_info",
        "card_number",
        "set_code",
    ]

    let original: String
    let tokens: [String]

    init(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= Self.maximumLength else {
            throw FieldLookupError.invalidSearch
        }

        let scrubbed = trimmed.replacingOccurrences(
            of: "[%,()*]",
            with: " ",
            options: .regularExpression
        )
        let pieces = scrubbed
            .split(whereSeparator: { $0.isWhitespace })
            .prefix(Self.maximumTokenCount)
            .map(String.init)

        guard !pieces.isEmpty else {
            throw FieldLookupError.invalidSearch
        }

        original = trimmed
        tokens = pieces
    }

    var normalizedIdentity: String {
        tokens.map { $0.lowercased() }.joined(separator: " ")
    }

    var postgRESTFilters: [URLQueryItem] {
        tokens.map { token in
            let alternatives = Self.searchableColumns
                .map { "\($0).ilike.%\(token)%" }
                .joined(separator: ",")
            return URLQueryItem(name: "or", value: "(\(alternatives))")
        }
    }
}
