import Foundation

struct AppConfiguration: Equatable, Sendable {
    let supabaseURL: URL
    let publishableKey: String
    let redirectURL: URL

    static func load(bundle: Bundle = .main) throws -> AppConfiguration {
        guard
            let rawURL = bundle.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            let supabaseURL = URL(string: rawURL),
            let scheme = supabaseURL.scheme?.lowercased(),
            ["https", "http"].contains(scheme),
            supabaseURL.host != nil
        else {
            throw ConfigurationError.missingSupabaseURL
        }

        guard
            let publishableKey = bundle.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String,
            !publishableKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            !publishableKey.contains("REPLACE_ME")
        else {
            throw ConfigurationError.missingPublishableKey
        }

        guard
            let rawRedirectURL = bundle.object(forInfoDictionaryKey: "SUPABASE_REDIRECT_URL") as? String,
            let redirectURL = URL(string: rawRedirectURL),
            redirectURL.scheme == "com.tztcg.fieldlookup"
        else {
            throw ConfigurationError.invalidRedirectURL
        }

        return AppConfiguration(
            supabaseURL: supabaseURL,
            publishableKey: publishableKey,
            redirectURL: redirectURL
        )
    }
}

enum ConfigurationError: Error, LocalizedError {
    case missingSupabaseURL
    case missingPublishableKey
    case invalidRedirectURL

    var errorDescription: String? {
        switch self {
        case .missingSupabaseURL:
            return "Field Lookup needs a valid Supabase project URL in Secrets.xcconfig."
        case .missingPublishableKey:
            return "Field Lookup needs the project's public publishable key in Secrets.xcconfig."
        case .invalidRedirectURL:
            return "Field Lookup needs the registered com.tztcg.fieldlookup auth callback URL."
        }
    }
}
