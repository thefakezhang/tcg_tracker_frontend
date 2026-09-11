import XCTest

final class FieldLookupUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testJapaneseResultAndDecisionDetailAtPhoneSize() throws {
        let app = launch(scenario: "live-japanese")
        let result = element("card-101", in: app)
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertTrue(result.isHittable)
        assertFitsWidth(result, in: app)
        let resultImage = element("result-card-image-101-loaded", in: app)
        XCTAssertTrue(resultImage.waitForExistence(timeout: 3))
        assertFitsWidth(resultImage, in: app)
        result.tap()

        XCTAssertTrue(app.staticTexts["ピカチュウ"].waitForExistence(timeout: 3))
        let detailImage = element("detail-card-image-loaded", in: app)
        XCTAssertTrue(detailImage.waitForExistence(timeout: 3))
        assertFitsWidth(detailImage, in: app)
        XCTAssertTrue(app.staticTexts["JP → NA"].exists)
        XCTAssertTrue(app.staticTexts["Sold comp"].exists)
        XCTAssertTrue(app.staticTexts["50%"].exists)
        assertDetailContentFitsWidth(in: app)
        attachScreenshot(name: "field-lookup-japanese-detail", app: app)

        app.swipeUp()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Owned across grades"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["Source observation time is unavailable from the summary API."].exists)
        assertDetailContentFitsWidth(in: app, stage: "after two upward swipes")
        attachScreenshot(name: "field-lookup-japanese-detail-freshness", app: app)
    }

    func testOfflineStaleAndUnknownStockAreExplicit() throws {
        let app = launch(scenario: "offline-stale")
        XCTAssertTrue(element("stale-cache-banner", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Offline cached result - stale"].exists)
        let result = element("card-101", in: app)
        XCTAssertTrue(result.isHittable)
        assertFitsWidth(result, in: app)
        XCTAssertTrue(
            element("result-card-image-101-unavailable", in: app)
                .waitForExistence(timeout: 3)
        )
        result.tap()
        let unavailableImage = element("detail-card-image-unavailable", in: app)
        XCTAssertTrue(unavailableImage.waitForExistence(timeout: 3))
        XCTAssertEqual(unavailableImage.label, "Card image unavailable")
        assertFitsWidth(unavailableImage, in: app)
        app.swipeUp()
        app.swipeUp()
        XCTAssertTrue(element("unknown-stock", in: app).waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["The stock request failed. This is not a zero count."].exists)
        attachScreenshot(name: "field-lookup-offline-stale", app: app)
    }

    func testRetryRecoversFromNetworkFailure() throws {
        let app = launch(scenario: "retry")
        XCTAssertTrue(element("lookup-error", in: app).waitForExistence(timeout: 5))
        let retry = element("retry-button", in: app)
        XCTAssertTrue(retry.isHittable)
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
        assertFitsWidth(retry, in: app)
        retry.tap()
        XCTAssertTrue(element("card-101", in: app).waitForExistence(timeout: 3))
        attachScreenshot(name: "field-lookup-retry-recovered", app: app)
    }

    func testExpiredSessionExplainsRecovery() throws {
        let app = launch(scenario: "session-expired")
        XCTAssertTrue(element("session-message", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Your session expired. Sign in again to continue."].exists)
        let signIn = element("google-sign-in", in: app)
        XCTAssertTrue(signIn.isHittable)
        XCTAssertGreaterThanOrEqual(signIn.frame.height, 44)
        assertFitsWidth(signIn, in: app)
        attachScreenshot(name: "field-lookup-session-expired", app: app)
    }

    func testMidSessionAccessDenialRequiresSignIn() throws {
        let app = launch(scenario: "access-revoked")
        let searchField = element("card-search-field", in: app)
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Pikachu")

        let searchButton = element("search-button", in: app)
        XCTAssertTrue(searchButton.isHittable)
        searchButton.tap()

        let message = element("session-message", in: app)
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts[
                "This session does not carry a recognized application role. Sign in again to continue."
            ].exists
        )
        let signIn = element("google-sign-in", in: app)
        XCTAssertTrue(signIn.isHittable)
        XCTAssertGreaterThanOrEqual(signIn.frame.height, 44)
        assertFitsWidth(signIn, in: app)
        XCTAssertTrue(searchField.waitForNonExistence(timeout: 2))
        XCTAssertFalse(element("retry-button", in: app).exists)
        attachScreenshot(name: "field-lookup-access-revoked", app: app)
    }

    func testLoadingStateIsReadable() throws {
        let app = launch(scenario: "loading")
        XCTAssertTrue(element("lookup-loading", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Loading current summaries"].exists)
        attachScreenshot(name: "field-lookup-loading", app: app)
    }

    private func launch(scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-test-scenario", scenario,
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
        ]
        app.launch()
        let window = app.windows.firstMatch.frame
        XCTAssertEqual(window.width, 390, accuracy: 0.5)
        XCTAssertEqual(window.height, 844, accuracy: 0.5)
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    private func assertFitsWidth(
        _ element: XCUIElement,
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let frame = element.frame
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frame.minX, window.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, window.maxX, file: file, line: line)
    }

    private func assertDetailContentFitsWidth(
        in app: XCUIApplication,
        stage: String = "before scrolling",
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let identifiers = [
            "detail-card-name",
            "price-direction",
            "entry-price-leg-title",
            "entry-price-leg-price",
            "entry-price-leg-source",
            "entry-price-leg-normalized",
            "exit-price-leg-title",
            "exit-price-leg-price",
            "exit-price-leg-source",
            "exit-price-leg-normalized",
            "exit-kind-note",
            "summary-roi",
        ]

        for identifier in identifiers {
            let content = element(identifier, in: app)
            XCTAssertTrue(
                content.exists,
                "Missing detail content \(stage): \(identifier)",
                file: file,
                line: line
            )
            let frame = content.frame
            let window = app.windows.firstMatch.frame
            XCTAssertGreaterThanOrEqual(
                frame.minX,
                window.minX,
                "Detail content starts outside the phone width \(stage): \(identifier), \(frame)",
                file: file,
                line: line
            )
            XCTAssertLessThanOrEqual(
                frame.maxX,
                window.maxX,
                "Detail content ends outside the phone width \(stage): \(identifier), \(frame)",
                file: file,
                line: line
            )
        }
    }

    private func attachScreenshot(name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
